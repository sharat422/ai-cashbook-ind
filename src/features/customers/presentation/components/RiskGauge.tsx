import React from 'react';
import {View} from 'react-native';
import Svg, {Circle, Path} from 'react-native-svg';

import {Text} from '@components/ui';
import type {RiskCategory} from '@features/customers/domain/risk';
import {RISK_STYLE} from './riskStyle';

const VB = 220; // viewBox width
const CX = 110;
const CY = 110;
const R = 88;
const STROKE = 18;

const ZONE_COLORS = {low: '#16A34A', med: '#F59E0B', high: '#DC2626'};

/** angle 0 = top, increasing clockwise. */
function polar(angleDeg: number): {x: number; y: number} {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return {x: CX + R * Math.cos(a), y: CY + R * Math.sin(a)};
}

/** Clockwise arc path from startAngle to endAngle. */
function arc(startAngle: number, endAngle: number): string {
  const s = polar(startAngle);
  const e = polar(endAngle);
  const large = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${s.x} ${s.y} A ${R} ${R} 0 ${large} 1 ${e.x} ${e.y}`;
}

// The dial is the top semicircle: score 0 → 270° (left), 100 → 450° (right).
const angleFor = (score: number): number => 270 + (score / 100) * 180;

export interface RiskGaugeProps {
  score: number;
  category: RiskCategory;
  size?: number;
}

/** Semicircular gauge dial: colour-coded zones + a value arc + the score. */
export function RiskGauge({
  score,
  category,
  size = 240,
}: RiskGaugeProps): React.JSX.Element {
  const height = size * 0.62;
  const value = angleFor(score);
  const color = RISK_STYLE[category].color;
  const end = polar(value);

  return (
    <View style={{width: size, height, alignSelf: 'center'}}>
      <Svg width={size} height={height} viewBox={`0 0 ${VB} ${VB * 0.62}`}>
        {/* Colour-coded zones (background) */}
        <Path d={arc(270, 331.2)} stroke={ZONE_COLORS.low} strokeOpacity={0.28} strokeWidth={STROKE} fill="none" />
        <Path d={arc(331.2, 391.2)} stroke={ZONE_COLORS.med} strokeOpacity={0.28} strokeWidth={STROKE} fill="none" />
        <Path d={arc(391.2, 450)} stroke={ZONE_COLORS.high} strokeOpacity={0.28} strokeWidth={STROKE} fill="none" />

        {/* Value arc */}
        {score > 0.5 ? (
          <Path
            d={arc(270, value)}
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            fill="none"
          />
        ) : null}

        {/* Marker */}
        <Circle cx={end.x} cy={end.y} r={STROKE / 2 + 2} fill="#fff" />
        <Circle cx={end.x} cy={end.y} r={STROKE / 2 - 2} fill={color} />
      </Svg>

      {/* Score + category overlay */}
      <View
        style={{position: 'absolute', left: 0, right: 0, bottom: height * 0.04}}
        className="items-center">
        <Text className="text-4xl font-bold" style={{color}}>
          {score}
        </Text>
        <Text variant="caption" className="-mt-1">
          out of 100
        </Text>
      </View>
    </View>
  );
}
