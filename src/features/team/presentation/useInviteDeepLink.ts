import {useEffect, useState} from 'react';
import {Alert, Linking} from 'react-native';

import {tNow} from '@/i18n';
import {useAuthStore} from '@store/auth.store';
import {inviteToken, joinWithInvite} from '../data/invites';

/**
 * AC2: an email invite's page offers bolcash://invite/<token>. Opened before
 * login, the invite waits until the person has signed in with their own mobile;
 * then it's accepted (the same membership as a phone invite) and the business opens.
 */
export function useInviteDeepLink(): void {
  const signedIn = useAuthStore(s => !!s.token);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    void Linking.getInitialURL().then(url => {
      const token = inviteToken(url);
      if (token) setPending(token);
    });
    const sub = Linking.addEventListener('url', ({url}) => {
      const token = inviteToken(url);
      if (token) setPending(token);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!pending || !signedIn) return;
    setPending(null);
    joinWithInvite(pending).then(
      r => Alert.alert(tNow('invite.joined', {name: r.businessName})),
      (e: Error) => Alert.alert(tNow('invite.failed'), e.message),
    );
  }, [pending, signedIn]);
}
