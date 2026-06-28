import React, {useState} from 'react';
import {View, type LayoutChangeEvent} from 'react-native';
import Svg, {Circle, Line, Path} from 'react-native-svg';

import {Text} from '@components/ui';
import type {TrendPoint} from '@features/khata/domain/entities';
import {colors} from '@theme/colors';
import {formatINR} from '@utils/currency';

const HEIGHT = 160;
const PAD = {l: 6, r: 6, t: 12, b: 4};
const COLLECTED = '#16A34A';
const BILLED = '#94A3B8';

const shortDate = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Reusable payment-trend line chart (collected vs billed) on react-native-svg. */
export function TrendChart({data}: {data: TrendPoint[]}): React.JSX.Element {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) =>
    setWidth(e.nativeEvent.layout.width);

  if (data.length === 0) {
    return <Text variant="caption">No trend data for this period.</Text>;
  }

  const max = Math.max(
    1,
    ...data.map(p => Math.max(p.collected, p.billed)),
  );
  const chartW = Math.max(0, width - PAD.l - PAD.r);
  const chartH = HEIGHT - PAD.t - PAD.b;
  const n = data.length;

  const x = (i: number) => PAD.l + (n <= 1 ? chartW / 2 : (i / (n - 1)) * chartW);
  const y = (v: number) => PAD.t + (1 - v / max) * chartH;

  const line = (key: 'collected' | 'billed') =>
    data
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p[key])}`)
      .join(' ');

  const area =
    `${line('collected')} L ${x(n - 1)} ${PAD.t + chartH} L ${x(0)} ${PAD.t + chartH} Z`;

  const labelIdx = [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <View>
      <Text variant="caption" className="mb-1">
        Peak {formatINR(max)}
      </Text>
      <View onLayout={onLayout} style={{height: HEIGHT}}>
        {width > 0 ? (
          <Svg width={width} height={HEIGHT}>
            {/* baseline */}
            <Line
              x1={PAD.l}
              y1={PAD.t + chartH}
              x2={width - PAD.r}
              y2={PAD.t + chartH}
              stroke={colors.border}
              strokeWidth={1}
            />
            {/* collected area + line */}
            {n > 1 ? (
              <Path d={area} fill={COLLECTED} fillOpacity={0.1} />
            ) : null}
            <Path
              d={line('billed')}
              stroke={BILLED}
              strokeWidth={2}
              fill="none"
            />
            <Path
              d={line('collected')}
              stroke={COLLECTED}
              strokeWidth={2.5}
              fill="none"
            />
            <Circle
              cx={x(n - 1)}
              cy={y(data[n - 1].collected)}
              r={4}
              fill={COLLECTED}
            />
          </Svg>
        ) : null}
      </View>

      {/* X labels */}
      <View className="mt-1 flex-row justify-between">
        {labelIdx.map((idx, i) => (
          <Text key={i} className="text-[10px] text-muted">
            {shortDate(data[idx].date)}
          </Text>
        ))}
      </View>

      {/* Legend */}
      <View className="mt-2 flex-row" style={{gap: 16}}>
        <Legend color={COLLECTED} label="Collected" />
        <Legend color={BILLED} label="Billed" />
      </View>
    </View>
  );
}

function Legend({color, label}: {color: string; label: string}): React.JSX.Element {
  return (
    <View className="flex-row items-center">
      <View
        className="mr-1.5 h-2 w-2 rounded-full"
        style={{backgroundColor: color}}
      />
      <Text className="text-xs text-muted">{label}</Text>
    </View>
  );
}
