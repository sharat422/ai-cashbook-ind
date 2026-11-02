import {apiRequest} from '@api/client';
import {assistantRemote} from './assistant.remote';

jest.mock('@api/client', () => ({apiRequest: jest.fn()}));
const api = apiRequest as jest.Mock;

beforeEach(() => api.mockReset());

it('asks with the transcript and maps the answer (no merchant id sent)', async () => {
  api.mockResolvedValueOnce({
    answer_text: 'Kaun sa Ramesh?',
    verified: true,
    data_source: 'database',
    tools_used: ['get_customer_balance'],
    candidates: [
      {customer_id: 'c1', name: 'TEST Ramesh', business_name: null, mobile_masked: '***3210'},
    ],
    sources: [],
    suggested_screen: null,
  });
  const out = await assistantRemote.ask({text: 'ramesh ka balance', inputMode: 'voice'});
  expect(api).toHaveBeenCalledWith('/chatbot/ask', {
    method: 'POST',
    body: {transcript_text: 'ramesh ka balance', input_mode: 'voice'},
  });
  expect(out.candidates).toEqual([
    {customerId: 'c1', name: 'TEST Ramesh', businessName: null, mobileMasked: '***3210'},
  ]);
  expect(out).toMatchObject({answer: 'Kaun sa Ramesh?', verified: true, dataSource: 'database'});
});

it('re-asks with the picked customer id', async () => {
  api.mockResolvedValueOnce({answer_text: 'ok', verified: true, data_source: 'database'});
  const out = await assistantRemote.ask({
    text: 'ramesh ka balance',
    inputMode: 'text',
    selectedCustomerId: 'c1',
  });
  expect(api.mock.calls[0][1].body.selected_customer_id).toBe('c1');
  expect(out.candidates).toEqual([]);
  expect(out.suggestedScreen).toBeNull();
});

it('deletes history', async () => {
  api.mockResolvedValueOnce({deleted: 3});
  await expect(assistantRemote.deleteHistory()).resolves.toBe(3);
  expect(api).toHaveBeenCalledWith('/chatbot/history', {method: 'DELETE'});
});

it('maps period, view-details and question id; drops unknown screens', async () => {
  api.mockResolvedValueOnce({
    question_id: 'q1', answer_text: 'a', verified: true, data_source: 'database',
    period: {from: '2026-10-01', to: '2026-10-31'},
    view_details: {screen: 'CustomerProfile', customer_id: 'c1'},
  });
  expect(await assistantRemote.ask({text: 'x', inputMode: 'text'})).toMatchObject({
    questionId: 'q1',
    period: {from: '2026-10-01', to: '2026-10-31'},
    viewDetails: {screen: 'CustomerProfile', customerId: 'c1'},
    blocked: null,
  });
  api.mockResolvedValueOnce({
    question_id: 'q2', answer_text: 'a', verified: true, data_source: 'database',
    period: {as_of: '2026-10-31'}, view_details: {screen: 'DeleteAccount'},
  });
  expect(await assistantRemote.ask({text: 'x', inputMode: 'text'})).toMatchObject({
    period: {asOf: '2026-10-31'},
    viewDetails: null,
  });
});

it('sends feedback with an optional trimmed note', async () => {
  api.mockResolvedValue({ok: true});
  await assistantRemote.feedback('q1', 'down', '  wrong amount ');
  await assistantRemote.feedback('q1', 'up', '   ');
  expect(api.mock.calls.map(c => c[1].body)).toEqual([
    {question_id: 'q1', rating: 'down', note: 'wrong amount'},
    {question_id: 'q1', rating: 'up'},
  ]);
});

it('sends the language hint when given', async () => {
  api.mockResolvedValueOnce({answer_text: 'ok', verified: true, data_source: 'none'});
  await assistantRemote.ask({text: 'x', inputMode: 'text', languageHint: 'ta'});
  expect(api.mock.calls[0][1].body.language_hint).toBe('ta');
});
