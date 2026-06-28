import {createNativeStackNavigator} from '@react-navigation/native-stack';
import React from 'react';

import {CreateBusinessScreen} from '@features/auth/screens/CreateBusinessScreen';
import type {OnboardingStackParamList} from './types';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

/** Shown to logged-in users who haven't created a business yet. */
export function OnboardingNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{headerShown: false}}>
      <Stack.Screen name="CreateBusiness" component={CreateBusinessScreen} />
    </Stack.Navigator>
  );
}
