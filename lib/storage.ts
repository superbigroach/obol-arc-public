// Firebase Storage upload helper for seller "skill" docs (Markdown / OpenAPI).
// Storage rules allow owner-write / public-read under skills/{uid}.
"use client";

import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";

/**
 * Upload a skill file (Markdown / JSON / YAML) for `uid` and return its public
 * download URL. Path: skills/{uid}/{timestamp}-{filename}.
 */
export async function uploadSkill(uid: string, file: File): Promise<string> {
  try {
    const path = `skills/${uid}/${Date.now()}-${file.name}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  } catch (e) {
    throw e instanceof Error ? e : new Error("Failed to upload skill file");
  }
}
