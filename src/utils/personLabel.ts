/** What to call a team member: the name the owner gave them, else their number. */
export function personLabel(name?: string | null, mobile?: string | null): string {
  return name?.trim() || (mobile ? `+91 ${mobile}` : '—');
}
