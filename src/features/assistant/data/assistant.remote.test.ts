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
