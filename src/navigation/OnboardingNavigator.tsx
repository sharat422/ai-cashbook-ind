import {createNativeStackNavigator} from '@react-navigation/native-stack';
import React from 'react';

import {CreateBusinessScreen} from '@features/auth/screens/CreateBusinessScreen';
import {ConsentScreen} from '@features/consent/presentation/screens/ConsentScreen';
import type {OnboardingStackParamList} from './types';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

/** Shown to logged-in users who haven't created a business yet. Granular
 * consent is captured first, then the business profile. */
export function OnboardingNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{headerShown: false}}>
      <Stack.Screen name="Consent" component={ConsentScreen} />
      <Stack.Screen name="CreateBusiness" component={CreateBusinessScreen} />
    </Stack.Navigator>
  );
}
