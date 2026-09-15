import time
import jwt
from app.config import settings
from app.routers.auth import _OTP_STORE
from helpers import add_customer


def test_otp_bound_expiring_single_use(client):
    mobile = '9988776651'
    vid = client.post('/api/v1/auth/otp/request', json={'mobile': mobile}).json()['verificationId']
    def verify(id=vid, phone=mobile):
        return client.post('/api/v1/auth/otp/verify', json={'verificationId': id, 'mobile': phone, 'otp': '123456'})
    assert verify(id='nonexistent').status_code == 400
    assert verify(phone='9988776652').status_code == 400
    _OTP_STORE[vid]['expires'] = time.monotonic() - 1
    assert verify().status_code == 400
    vid2 = client.post('/api/v1/auth/otp/request', json={'mobile': mobile}).json()['verificationId']
    assert verify(id=vid2).status_code == 200
    assert verify(id=vid2).status_code == 400


def test_otp_attempt_limit(client):
    mobile = '9988776653'
    vid = client.post('/api/v1/auth/otp/request', json={'mobile': mobile}).json()['verificationId']
    _OTP_STORE[vid]['otp'] = '555555'
    for _ in range(5):
        assert client.post('/api/v1/auth/otp/verify', json={'verificationId': vid, 'mobile': mobile, 'otp': '000000'}).status_code == 400
    assert client.post('/api/v1/auth/otp/verify', json={'verificationId': vid, 'mobile': mobile, 'otp': '123456'}).status_code == 400


def test_production_auth_fails_closed(client, monkeypatch):
    monkeypatch.setattr(settings, 'debug', False)
    assert client.post('/api/v1/auth/otp/request', json={'mobile': '9988776654'}).status_code == 503


def test_token_requires_expiry(client, user):
    token = jwt.encode({'sub': 'anything'}, settings.jwt_secret, algorithm='HS256')
    assert client.get('/api/v1/incomes', headers={'Authorization': f'Bearer {token}'}).status_code == 401


def test_entry_date_id_and_upload_validation(client, user):
    body = dict(amount='20', category='Sales', date='2026-02-30', client_id='a')
    assert client.post('/api/v1/incomes', headers=user.headers, data=body).status_code == 422
    body.update(date='2026-09-15', client_id=' ')
    assert client.post('/api/v1/incomes', headers=user.headers, data=body).status_code == 422
    body['client_id'] = 'upload-test'
    assert client.post('/api/v1/incomes', headers=user.headers, data=body,
                       files={'attachment': ('bad.html', b'<script>x</script>', 'text/html')}).status_code == 422
    customer = add_customer(client, user.headers)
    assert client.post(f"/api/v1/customers/{customer['id']}/ledger", headers=user.headers,
                       data=dict(type='credit', amount=20, date='invalid', client_id='bad')).status_code == 422
