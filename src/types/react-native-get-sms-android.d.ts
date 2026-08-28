// The package ships no types. Declare the minimal surface we use.
declare module 'react-native-get-sms-android' {
  interface SmsAndroidStatic {
    /**
     * List SMS matching a JSON `filter` string (e.g. {"box":"inbox"}).
     * Calls `fail(error)` or `success(count, smsListJson)`.
     */
    list(
      filter: string,
      fail: (error: string) => void,
      success: (count: number, smsListJson: string) => void,
    ): void;
  }
  const SmsAndroid: SmsAndroidStatic;
  export default SmsAndroid;
}
