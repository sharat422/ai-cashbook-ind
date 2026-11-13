import {useQueryClient} from '@tanstack/react-query';
import React, {useState} from 'react';
import {Alert, View} from 'react-native';

import {FormField} from '@components/form/FormField';
import {TextField} from '@components/form/TextField';
import {Button, Text} from '@components/ui';
import {useT} from '@/i18n';
import {inviteToken, joinWithInvite} from '../data/invites';

/** AC2: someone invited by email pastes the link here (or opens it on the phone). */
export function JoinInviteCard(): React.JSX.Element {
  const t = useT();
  const qc = useQueryClient();
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);

  const join = async () => {
    const token = inviteToken(link);
    if (!token) {
      Alert.alert(t('invite.badLink'));
      return;
    }
    setBusy(true);
    try {
      const r = await joinWithInvite(token);
      setLink('');
      await qc.invalidateQueries({queryKey: ['my-businesses']});
      Alert.alert(t('invite.joined', {name: r.businessName}));
    } catch (e) {
      Alert.alert(t('invite.failed'), e instanceof Error ? e.message : t('common.tryAgainMsg'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="mt-6 rounded-2xl border border-border bg-white p-4">
      <Text variant="label">{t('invite.joinTitle')}</Text>
      <Text variant="caption" className="mb-2">{t('invite.joinHint')}</Text>
      <FormField label={t('invite.linkLabel')}>
        <TextField testID="invite-link" value={link} onChangeText={setLink} autoCapitalize="none"
          autoCorrect={false} placeholder={t('invite.linkPlaceholder')} />
      </FormField>
      <Button testID="invite-join" title={t('invite.join')} variant="secondary" loading={busy}
        disabled={!link.trim()} onPress={() => void join()} />
    </View>
  );
}
