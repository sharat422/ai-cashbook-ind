import RNFS from 'react-native-fs';
import Share from 'react-native-share';

import {accountRemote} from '@features/account/data/account.remote';

/** True when the user simply dismissed the OS share sheet (not an error). */
function isCancel(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /cancel|did not share|dismiss/i.test(msg);
}

/**
 * Fetch the user's full data export, write it to a JSON file, and open the OS
 * share sheet so they can save it (Files, Drive, email, etc.).
 * Returns true if a file was produced, false if the user cancelled sharing.
 */
export async function downloadMyData(): Promise<boolean> {
  const data = await accountRemote.exportData();
  const stamp = new Date().toISOString().slice(0, 10);
  const fileName = `smart-cashbook-data-${stamp}.json`;
  const path = `${RNFS.DocumentDirectoryPath}/${fileName}`;
  await RNFS.writeFile(path, JSON.stringify(data, null, 2), 'utf8');
  try {
    await Share.open({
      url: `file://${path}`,
      type: 'application/json',
      filename: fileName,
      failOnCancel: false,
    });
    return true;
  } catch (err) {
    if (isCancel(err)) return false;
    throw err;
  }
}
