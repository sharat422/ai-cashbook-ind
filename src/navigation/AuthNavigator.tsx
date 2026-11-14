import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {screenLayout} from './screenLayout';
import React from 'react';

import {LoginScreen} from '@features/auth/screens/LoginScreen';
import {OtpScreen} from '@features/auth/screens/OtpScreen';
import {LegalDocScreen} from '@features/legal/presentation/screens/LegalDocScreen';
import type {AuthStackParamList} from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

/** Login → OTP. */
export function AuthNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{headerShown: false}} screenLayout={screenLayout}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Otp" component={OtpScreen} />
      <Stack.Screen name="LegalDoc" component={LegalDocScreen} />
    </Stack.Navigator>
  );
}
