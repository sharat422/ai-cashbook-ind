from app.config import settings
from helpers import add_income, add_expense


def test_daily_narrative_is_scoped_and_falls_back(client, user, make_user, monkeypatch):
    monkeypatch.setattr(settings, 'openai_api_key', '')
    day = '2026-09-15'
    other = make_user()
    add_income(client, user.headers, amount=1000, date=day, client_id='summary-income')
    add_expense(client, user.headers, amount=250, date=day, client_id='summary-expense')
    add_income(client, other.headers, amount=99000, date=day, client_id='private')
    response = client.post('/api/v1/summary/daily/insights', headers=user.headers, json={'date': day})
    assert response.status_code == 200
    data = response.json()
    assert data['source'] == 'rules'
    assert data['facts']['income'] == 1000
    assert data['facts']['profit'] == 750
    assert '99,000' not in data['narrative']
    assert client.post('/api/v1/summary/daily/insights', json={'date': day}).status_code == 403
    assert client.post('/api/v1/summary/daily/insights', headers=user.headers, json={'date': 'bad'}).status_code == 422


def test_ai_failure_returns_totals(client, user, monkeypatch):
    import openai
    monkeypatch.setattr(settings, 'openai_api_key', 'test-only')
    def unavailable(**kwargs):
        raise TimeoutError('provider unavailable')
    monkeypatch.setattr(openai, 'OpenAI', unavailable)
    response = client.post('/api/v1/summary/daily/insights', headers=user.headers,
                           json={'date': '2026-09-15'})
    assert response.status_code == 200
    assert response.json()['source'] == 'rules'


def test_ai_narrative_is_explicitly_labelled(client, user, monkeypatch):
    import openai
    from types import SimpleNamespace
    monkeypatch.setattr(settings, 'openai_api_key', 'test-only')
    class FakeClient:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=self)
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def create(self, **kwargs):
            assert 'transaction_count' in kwargs['messages'][1]['content']
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='Review your entries.'))])
    monkeypatch.setattr(openai, 'OpenAI', FakeClient)
    result = client.post('/api/v1/summary/daily/insights', headers=user.headers,
                         json={'date': '2026-09-15'}).json()
    assert result['source'] == 'ai'
    assert result['narrative'] == 'Review your entries.'
