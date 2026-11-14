import React from 'react';
import {Image} from 'react-native';

import {APP_CONFIG} from '@config/constants';

/** Width ÷ height of src/assets/brand/logo.png (the full Bolcash logo). */
const RATIO = 3.0608;

/** The Bolcash logo (mark and name), on a light background. */
export function BrandLogo({width = 220}: {width?: number}): React.JSX.Element {
  return (
    <Image
      testID="brand-logo"
      source={require('../../assets/brand/logo.png')}
      style={{width, height: width / RATIO}}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel={APP_CONFIG.name}
    />
  );
}
