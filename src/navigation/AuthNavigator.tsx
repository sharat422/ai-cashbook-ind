import {createNativeStackNavigator} from '@react-navigation/native-stack';
import React from 'react';

import {LoginScreen} from '@features/auth/screens/LoginScreen';
import {OtpScreen} from '@features/auth/screens/OtpScreen';
import type {AuthStackParamList} from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

/** Login → OTP. */
export function AuthNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{headerShown: false}}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Otp" component={OtpScreen} />
    </Stack.Navigator>
  );
}
