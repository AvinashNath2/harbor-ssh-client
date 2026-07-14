import { useCallback, useEffect, useState } from "react";
import { deleteProfile, listProfiles, saveProfile, type ConnectionProfile } from "../api";

export function useProfiles() {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);

  useEffect(() => {
    void listProfiles().then(setProfiles);
  }, []);

  const save = useCallback(async (profile: ConnectionProfile) => {
    await saveProfile(profile);
    setProfiles(await listProfiles());
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteProfile(id);
    setProfiles((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return { profiles, save, remove };
}
