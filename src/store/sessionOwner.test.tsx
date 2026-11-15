/**
 * Entries waiting to sync stay on the phone across app restarts (every start
 * is a fresh login). The next login decides what happens to them: the same
 * business keeps them (they sync); anyone else starts clean, so A's entries
 * never sync into B's business. Logging out still wipes.
 */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {useIncomeStore} from '@features/income/presentation/store/income.store';
import {useAuthStore} from '@store/auth.store';
import {useLocalDataOwner, useSessionDataReset} from './sessionReset';

function Probe(): null {
  useSessionDataReset();
  return null;
}
const login = (id: string | null) =>
  act(() => { useAuthStore.setState({business: id ? ({id} as never) : null}); });
const waiting = () => useIncomeStore.getState().queue.length;

/** A fresh start: logged out, with business A's entry still waiting on the phone. */
function freshStartWithAsEntry(): ReactTestRenderer {
  useLocalDataOwner.setState({businessId: 'A'});
  useAuthStore.setState({business: null});
  useIncomeStore.setState({queue: [{localId: 'q1'} as never]});
  let r!: ReactTestRenderer;
  act(() => { r = create(<Probe />); });
  return r;
}

test('logging back in to the same business keeps its waiting entries', () => {
  const r = freshStartWithAsEntry();
  login('A');
  expect(waiting()).toBe(1);
  act(() => r.unmount());
});

test("someone else logging in next never gets A's entries", () => {
  const r = freshStartWithAsEntry();
  login('B');
  expect(waiting()).toBe(0);
  expect(useLocalDataOwner.getState().businessId).toBe('B');
  act(() => r.unmount());
});

test('logging out still wipes', () => {
  const r = freshStartWithAsEntry();
  login('A');
  login(null);
  expect(waiting()).toBe(0);
  act(() => r.unmount());
});
