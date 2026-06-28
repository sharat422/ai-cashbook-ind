/**
 * Composition root for the Customers feature.
 */
import {customerRepository} from './data/customer.repository';
import {ledgerRepository} from './data/ledger.repository';
import {makeCustomerUseCases} from './domain/usecases';
import {makeLedgerUseCases} from './domain/usecases/ledger';

export const customerUseCases = makeCustomerUseCases(customerRepository);
export const ledgerUseCases = makeLedgerUseCases(ledgerRepository);
