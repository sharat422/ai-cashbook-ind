import React from 'react';
import {View} from 'react-native';

import {Text} from '@components/ui';
import {useT} from '@/i18n';
import {categoryLabel} from '@/i18n/labels';
import type {CategorizationDecision} from '@features/categorization/domain/entities';

/** One row in the learning log. */
function DecisionRow({
  decision,
}: {
  decision: CategorizationDecision;
}): React.JSX.Element {
  const t = useT();
  const {result} = decision;
  const corrected = decision.userCorrectedCategory;
  const pct = Math.round(result.confidence * 100);

  return (
    <View className="rounded-xl border border-border bg-white px-4 py-3">
      <Text className="text-sm text-slate-700" numberOfLines={1}>
        {decision.text || t('categorize.noText')}
      </Text>
      <View className="mt-1.5 flex-row items-center" style={{gap: 6}}>
        <Text
          className={`text-xs font-semibold ${
            corrected ? 'text-muted line-through' : 'text-slate-900'
          }`}>
          {categoryLabel(t, result.category)}
        </Text>
        {corrected ? (
          <Text className="text-xs font-semibold text-success">
            → {categoryLabel(t, corrected)}
          </Text>
        ) : null}
        <Text className="text-[11px] text-muted">
          · {t(result.source === 'ai' ? 'categorize.ai' : 'categorize.rule')} {pct}%
        </Text>
        {corrected ? (
          <Text className="text-[11px] font-medium text-primary">
            · {t('categorize.learned')}
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
  const t = useT();
  if (decisions.length === 0) {
    return (
      <Text variant="caption">
        {t('categorize.noDecisions')}
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
