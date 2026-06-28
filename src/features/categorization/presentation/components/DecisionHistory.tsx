import React from 'react';
import {View} from 'react-native';

import {Text} from '@components/ui';
import type {CategorizationDecision} from '@features/categorization/domain/entities';

/** One row in the learning log. */
function DecisionRow({
  decision,
}: {
  decision: CategorizationDecision;
}): React.JSX.Element {
  const {result} = decision;
  const corrected = decision.userCorrectedCategory;
  const pct = Math.round(result.confidence * 100);

  return (
    <View className="rounded-xl border border-border bg-white px-4 py-3">
      <Text className="text-sm text-slate-700" numberOfLines={1}>
        {decision.text || '(no text)'}
      </Text>
      <View className="mt-1.5 flex-row items-center" style={{gap: 6}}>
        <Text
          className={`text-xs font-semibold ${
            corrected ? 'text-muted line-through' : 'text-slate-900'
          }`}>
          {result.category}
        </Text>
        {corrected ? (
          <Text className="text-xs font-semibold text-success">
            → {corrected}
          </Text>
        ) : null}
        <Text className="text-[11px] text-muted">
          · {result.source === 'ai' ? 'AI' : 'Rule'} {pct}%
        </Text>
        {corrected ? (
          <Text className="text-[11px] font-medium text-primary">
            · learned
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The stored learning log — past decisions and any user corrections. Corrections
 * are the labelled data you'd later export to fine-tune the model or tune rules.
 */
export function DecisionHistory({
  decisions,
}: {
  decisions: CategorizationDecision[];
}): React.JSX.Element {
  if (decisions.length === 0) {
    return (
      <Text variant="caption">
        No decisions yet. Categorize some text to start building the log.
      </Text>
    );
  }
  return (
    <View style={{gap: 8}}>
      {decisions.map(decision => (
        <DecisionRow key={decision.id} decision={decision} />
      ))}
    </View>
  );
}
