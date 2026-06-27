import { initializeApp, getApp, getApps, FirebaseApp } from "firebase/app";
import { getFirestore, Firestore, doc, getDocFromServer } from "firebase/firestore";
import { getAuth } from "firebase/auth";

let app: FirebaseApp | null = null;
let db: Firestore | null = null;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  let authUser: any = null;
  try {
    if (app) {
      authUser = getAuth(app).currentUser;
    } else if (getApps().length > 0) {
      authUser = getAuth(getApp()).currentUser;
    }
  } catch (e) {
    // Ignore auth fetch errors
  }

  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: authUser?.uid || null,
      email: authUser?.email || null,
      emailVerified: authUser?.emailVerified || null,
      isAnonymous: authUser?.isAnonymous || null,
      tenantId: authUser?.tenantId || null,
      providerInfo: authUser?.providerData?.map((provider: any) => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function initFirebase(): Promise<Firestore> {
  if (db) return db;

  try {
    const res = await fetch("/api/config");
    if (!res.ok) {
      throw new Error("Failed to fetch Firebase config from server");
    }
    const config = await res.json();
    if (!config || !config.apiKey) {
      throw new Error("Invalid or empty Firebase configuration received");
    }

    // Initialize Firebase
    if (getApps().length === 0) {
      app = initializeApp({
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        projectId: config.projectId,
        storageBucket: config.storageBucket,
        messagingSenderId: config.messagingSenderId,
        appId: config.appId
      });
    } else {
      app = getApp();
    }

    // Use specific firestoreDatabaseId if specified, or default
    db = getFirestore(app, config.firestoreDatabaseId || "default");

    // Validate Connection to Firestore (Prerequisite Guideline)
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
      console.log("Firestore connection validated successfully.");
    } catch (error: any) {
      if (error && error.message && error.message.includes('the client is offline')) {
        console.error("Firestore client is offline. Please check your Firebase configuration.");
      } else {
        console.log("Firestore connection verification complete (note: test document may not exist, which is expected):", error.message);
      }
    }

    return db;
  } catch (error) {
    console.error("Error in initFirebase:", error);
    throw error;
  }
}
