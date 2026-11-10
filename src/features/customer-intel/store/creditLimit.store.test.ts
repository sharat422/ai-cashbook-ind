import {ApiError, NetworkError} from '@api/client';
import {customerRemote} from '@features/customers/data/customer.remote';
import {uploadLocalCreditLimits, useCreditLimitStore} from './creditLimit.store';

jest.mock('@features/customers/data/customer.remote', () => ({
  customerRemote: {setCreditLimit: jest.fn()},
}));
const setLimit = customerRemote.setCreditLimit as jest.Mock;

beforeEach(() => jest.clearAllMocks());

test('phone-only limits are uploaded once, then forgotten locally', async () => {
  useCreditLimitStore.setState({limits: {a: 5000, gone: 100}});
  setLimit.mockResolvedValueOnce({}).mockRejectedValueOnce(new ApiError(404, 'Customer not found'));
  expect(await uploadLocalCreditLimits()).toBe(true);
  expect(setLimit).toHaveBeenCalledWith('a', 5000, 0); // only if the server never had a limit
  expect(useCreditLimitStore.getState().limits).toEqual({});
  expect(await uploadLocalCreditLimits()).toBe(false);
  expect(setLimit).toHaveBeenCalledTimes(2);
});

test('offline or not allowed: kept for the next try', async () => {
  useCreditLimitStore.setState({limits: {a: 5000, b: 900}});
  setLimit.mockRejectedValueOnce(new NetworkError('offline'));
  expect(await uploadLocalCreditLimits()).toBe(false);
  setLimit.mockRejectedValue(new ApiError(403, 'no'));
  expect(await uploadLocalCreditLimits()).toBe(false);
  expect(useCreditLimitStore.getState().limits).toEqual({a: 5000, b: 900});
});

test('a limit set on another device wins, with a notice in the inbox', async () => {
  const {useInboxStore} = require('@/services/notifications/inbox.store');
  useInboxStore.setState({notifications: []});
  useCreditLimitStore.setState({limits: {a: 5000, b: 900}});
  setLimit.mockRejectedValueOnce(new ApiError(409, 'changed')).mockResolvedValueOnce({});
  expect(await uploadLocalCreditLimits()).toBe(true);
  expect(useCreditLimitStore.getState().limits).toEqual({}); // the old value is dropped, not forced
  const notes = useInboxStore.getState().notifications;
  expect(notes).toHaveLength(1);
  expect(notes[0].data).toEqual({type: 'credit-limit-conflict'});
});
