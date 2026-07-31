import type { ConnectionProfile } from "../api";

export interface ConnectCredentialOptions {
  password?: string;
  /** Default true — when false, stored password is cleared after a successful connect. */
  savePassword?: boolean;
  keyPassphrase?: string;
  saveKeyPassphrase?: boolean;
}

export function mergeCredentialsIntoProfile(
  profile: ConnectionProfile,
  creds?: ConnectCredentialOptions,
): ConnectionProfile {
  if (!creds) return profile;
  const next: ConnectionProfile = { ...profile };
  if (creds.savePassword !== false && creds.password) {
    next.savedPassword = creds.password;
  } else if (creds.savePassword === false) {
    delete next.savedPassword;
  }
  if (creds.saveKeyPassphrase !== false && creds.keyPassphrase) {
    next.savedKeyPassphrase = creds.keyPassphrase;
  } else if (creds.saveKeyPassphrase === false) {
    delete next.savedKeyPassphrase;
  }
  return next;
}

export function passwordForProfile(profile: ConnectionProfile): string | undefined {
  return profile.savedPassword;
}

export function keyPassphraseForProfile(profile: ConnectionProfile): string | undefined {
  return profile.savedKeyPassphrase;
}
