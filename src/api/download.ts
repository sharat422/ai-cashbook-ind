import RNFS from 'react-native-fs';
import Share from 'react-native-share';

import {ApiError, apiErrorMessage} from '@api/client';
import {API_ROOT} from '@config/env';
import {useAuthStore} from '@store/auth.store';

/** Download an authenticated API file into the app's documents; returns its path. */
export async function downloadFile(path: string, fileName: string): Promise<string> {
  const toFile = `${RNFS.DocumentDirectoryPath}/${fileName}`;
  const token = useAuthStore.getState().token;
  const {statusCode} = await RNFS.downloadFile({
    fromUrl: `${API_ROOT}${path}`,
    toFile,
    headers: token ? {Authorization: `Bearer ${token}`} : {},
  }).promise;
  if (statusCode !== 200) {
    await RNFS.unlink(toFile).catch(() => undefined);
    const detail = `Download failed (${statusCode}).`;
    throw new ApiError(statusCode, apiErrorMessage(statusCode, detail), detail);
  }
  return toFile;
}

/** Download an authenticated API file (Excel/CSV/PDF reports) and open the share
 *  sheet. Not for statement, ledger or bill files — those go through sharePdf,
 *  which checks the retailer's consent first (ST3). */
export async function downloadAndShare(path: string, fileName: string, mime: string): Promise<void> {
  const toFile = await downloadFile(path, fileName);
  await Share.open({url: `file://${toFile}`, type: mime, failOnCancel: false});
}
