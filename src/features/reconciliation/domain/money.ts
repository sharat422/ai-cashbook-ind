const GROUP = new Intl.NumberFormat('en-IN', {maximumFractionDigits: 0});

/** Format the server's exact decimal string ("123456.70") as ₹1,23,456.70
 *  without going through float arithmetic. */
export function formatMoney(value: string): string {
  const negative = value.startsWith('-');
  const [rupees, paise = ''] = (negative ? value.slice(1) : value).split('.');
  return `${negative ? '−' : ''}₹${GROUP.format(Number(rupees))}.${paise.padEnd(2, '0').slice(0, 2)}`;
}

export const isZero = (value: string): boolean => /^-?0+(\.0+)?$/.test(value);
