import {Alert, Linking} from 'react-native';

/**
 * Open an external URL (legal pages, support links) in the system browser.
 * Shows a user-facing message with the raw URL when the device can't open it,
 * so the user can always reach the page manually.
 */
export async function openExternalUrl(url: string): Promise<void> {
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) throw new Error(`Cannot open URL: ${url}`);
    await Linking.openURL(url);
  } catch {
    Alert.alert(
      'Couldn’t open the link',
      `Please visit ${url} in your browser.`,
    );
  }
}
