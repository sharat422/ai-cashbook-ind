import {Alert} from 'react-native';

import {tNow} from '@/i18n';

/**
 * On a Save with problems, also say what's wrong in a popup: the red text
 * under a field can be scrolled off screen (Amount is at the top, Save at the
 * bottom). Returns true when there were problems (= don't save).
 */
export function alertFieldErrors(errors: Partial<Record<string, string>>): boolean {
  const lines = Object.values(errors).filter((m): m is string => !!m);
  if (lines.length === 0) return false;
  Alert.alert(tNow('form.checkTitle'), lines.map(l => `• ${l}`).join('\n'));
  return true;
}
