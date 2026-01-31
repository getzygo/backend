# OAuth Strategy & External Integrations

**Version:** 1.0.0
**Last Updated:** January 26, 2026
**Status:** Production-Ready
**OAuth Version:** OAuth 2.0 / OpenID Connect

---

## Table of Contents

1. [Overview](#overview)
2. [OAuth Architecture](#oauth-architecture)
3. [Authentication Providers](#authentication-providers)
4. [External Data Sources](#external-data-sources)
5. [OAuth Flows](#oauth-flows)
6. [Token Management](#token-management)
7. [Provider Configurations](#provider-configurations)
8. [Database Schema](#database-schema)
9. [API Endpoints](#api-endpoints)
10. [Security Considerations](#security-considerations)
11. [UI Components](#ui-components)
12. [Error Handling](#error-handling)
13. [Testing & Development](#testing--development)

---

## Overview

### Two OAuth Use Cases

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OAUTH USE CASES                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌───────────────────────────────┐    ┌───────────────────────────────┐    │
│  │   1. AUTHENTICATION (SSO)     │    │   2. EXTERNAL INTEGRATIONS    │    │
│  ├───────────────────────────────┤    ├───────────────────────────────┤    │
│  │                               │    │                               │    │
│  │  "Login with Google"          │    │  "Connect OneDrive"           │    │
│  │  "Login with GitHub"          │    │  "Connect Google Drive"       │    │
│  │  "Login with Microsoft"       │    │  "Connect Slack"              │    │
│  │                               │    │  "Connect Jira"               │    │
│  │  Purpose:                     │    │                               │    │
│  │  • User identity verification │    │  Purpose:                     │    │
│  │  • SSO convenience            │    │  • Access external data       │    │
│  │  • Profile information        │    │  • Sync files/documents       │    │
│  │                               │    │  • Send notifications         │    │
│  │  Scopes: Basic profile/email  │    │  • Automate workflows         │    │
│  │  Token Storage: Session only  │    │                               │    │
│  │                               │    │  Scopes: Extended permissions │    │
│  └───────────────────────────────┘    │  Token Storage: Encrypted DB  │    │
│                                        └───────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Supported Providers

| Category | Provider | Auth | Integration | Scopes |
|----------|----------|------|-------------|--------|
| **Identity** | Google | ✅ | ✅ | profile, email, drive, calendar |
| | Microsoft | ✅ | ✅ | profile, email, files, calendar, mail |
| | GitHub | ✅ | ✅ | user, repo, workflow |
| | Apple | ✅ | ❌ | name, email |
| **Productivity** | Slack | ❌ | ✅ | channels, chat, files |
| | Notion | ❌ | ✅ | read, write, comments |
| | Jira | ❌ | ✅ | read, write, admin |
| | Confluence | ❌ | ✅ | read, write |
| | Asana | ❌ | ✅ | read, write |
| **Storage** | Dropbox | ❌ | ✅ | files.read, files.write |
| | Box | ❌ | ✅ | read, write |
| | OneDrive | ❌ | ✅ | files.read, files.readwrite |
| | Google Drive | ❌ | ✅ | drive.readonly, drive |
| | SharePoint | ❌ | ✅ | sites.read, files.readwrite |
| **Communication** | Outlook | ❌ | ✅ | mail.read, mail.send, calendar |
| | Gmail | ❌ | ✅ | gmail.readonly, gmail.send |
| | Teams | ❌ | ✅ | chat, channel, meeting |
| | Zoom | ❌ | ✅ | meeting:read, meeting:write |
| **Development** | GitLab | ✅ | ✅ | read_user, api, read_repository |
| | Bitbucket | ❌ | ✅ | repository, pullrequest |
| | Linear | ❌ | ✅ | read, write |

---

## OAuth Architecture

### System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         OAUTH SYSTEM ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐                                                             │
│  │   Browser   │                                                             │
│  │   (User)    │                                                             │
│  └──────┬──────┘                                                             │
│         │                                                                    │
│         │ 1. Click "Connect Google Drive"                                    │
│         ▼                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         ZYGO FRONTEND                                │    │
│  │                        (app.zygo.tech)                               │    │
│  └──────┬──────────────────────────────────────────────────────────────┘    │
│         │                                                                    │
│         │ 2. GET /api/v1/oauth/authorize?provider=google-drive              │
│         ▼                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         ZYGO BACKEND                                 │    │
│  │                        (api.zygo.tech)                               │    │
│  │                                                                      │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │    │
│  │  │ OAuth Service   │  │ Token Service   │  │ Crypto Service  │     │    │
│  │  │ • Generate URL  │  │ • Store tokens  │  │ • Encrypt/Decrypt│     │    │
│  │  │ • Handle callback│ │ • Refresh tokens│  │ • Key rotation   │     │    │
│  │  │ • Validate state│  │ • Revoke tokens │  │                  │     │    │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘     │    │
│  └──────┬──────────────────────────────────────────────────────────────┘    │
│         │                                                                    │
│         │ 3. Redirect to Google OAuth                                        │
│         ▼                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      OAUTH PROVIDER                                  │    │
│  │                   (accounts.google.com)                              │    │
│  │                                                                      │    │
│  │  • User authenticates                                                │    │
│  │  • User grants permissions                                           │    │
│  │  • Provider issues authorization code                                │    │
│  └──────┬──────────────────────────────────────────────────────────────┘    │
│         │                                                                    │
│         │ 4. Redirect to callback with code                                  │
│         ▼                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         ZYGO BACKEND                                 │    │
│  │                                                                      │    │
│  │  5. Exchange code for tokens                                         │    │
│  │  6. Encrypt and store tokens                                         │    │
│  │  7. Create oauth_connection record                                   │    │
│  └──────┬──────────────────────────────────────────────────────────────┘    │
│         │                                                                    │
│         │ 8. Redirect to success page                                        │
│         ▼                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         ZYGO FRONTEND                                │    │
│  │                     "Google Drive Connected!"                        │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| **OAuth Service** | Generate auth URLs, handle callbacks, validate state |
| **Token Service** | Store, refresh, revoke tokens |
| **Crypto Service** | Encrypt/decrypt tokens, manage encryption keys |
| **Provider Registry** | Store provider configurations, scopes, endpoints |
| **Connection Manager** | Track user connections, sync status |

---

## Authentication Providers

### SSO Login Flow

```typescript
// User clicks "Login with Google"
// 1. Frontend redirects to backend
GET /api/v1/auth/oauth/google

// 2. Backend generates auth URL and redirects
302 Redirect → https://accounts.google.com/o/oauth2/v2/auth?
  client_id=xxx&
  redirect_uri=https://api.zygo.tech/api/v1/auth/oauth/google/callback&
  response_type=code&
  scope=openid%20profile%20email&
  state=encrypted_state&
  code_challenge=xxx&
  code_challenge_method=S256

// 3. User authenticates with Google
// 4. Google redirects to callback
GET /api/v1/auth/oauth/google/callback?code=xxx&state=xxx

// 5. Backend exchanges code for tokens
POST https://oauth2.googleapis.com/token
{
  code: "xxx",
  client_id: "xxx",
  client_secret: "xxx",
  redirect_uri: "https://api.zygo.tech/api/v1/auth/oauth/google/callback",
  grant_type: "authorization_code",
  code_verifier: "xxx"
}

// 6. Backend gets user info
GET https://www.googleapis.com/oauth2/v2/userinfo
Authorization: Bearer {access_token}

// 7. Backend creates/updates user, issues session
// 8. Redirect to frontend with session cookie
302 Redirect → https://app.zygo.tech/dashboard
```

### Authentication Provider Configuration

```typescript
interface AuthProvider {
  id: string;
  name: string;
  type: 'oauth2' | 'oidc';
  enabled: boolean;

  // OAuth endpoints
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  revokeUrl?: string;

  // Client credentials (from env)
  clientId: string;
  clientSecret: string;

  // Scopes for authentication only
  scopes: string[];

  // Response mapping
  profileMapping: {
    id: string;         // Path to user ID in response
    email: string;      // Path to email
    name?: string;      // Path to name
    avatar?: string;    // Path to avatar URL
  };

  // Additional settings
  pkceRequired: boolean;
  stateRequired: boolean;
}

const AUTH_PROVIDERS: Record<string, AuthProvider> = {
  google: {
    id: 'google',
    name: 'Google',
    type: 'oidc',
    enabled: true,
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    scopes: ['openid', 'profile', 'email'],
    profileMapping: {
      id: 'id',
      email: 'email',
      name: 'name',
      avatar: 'picture',
    },
    pkceRequired: true,
    stateRequired: true,
  },

  github: {
    id: 'github',
    name: 'GitHub',
    type: 'oauth2',
    enabled: true,
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    revokeUrl: undefined, // GitHub doesn't support programmatic revocation
    clientId: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    scopes: ['read:user', 'user:email'],
    profileMapping: {
      id: 'id',
      email: 'email',
      name: 'name',
      avatar: 'avatar_url',
    },
    pkceRequired: false,
    stateRequired: true,
  },

  microsoft: {
    id: 'microsoft',
    name: 'Microsoft',
    type: 'oidc',
    enabled: true,
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
    revokeUrl: undefined,
    clientId: process.env.MICROSOFT_CLIENT_ID!,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
    scopes: ['openid', 'profile', 'email', 'User.Read'],
    profileMapping: {
      id: 'id',
      email: 'mail',
      name: 'displayName',
      avatar: undefined, // Requires separate Graph API call
    },
    pkceRequired: true,
    stateRequired: true,
  },

  apple: {
    id: 'apple',
    name: 'Apple',
    type: 'oidc',
    enabled: true,
    authorizationUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    userInfoUrl: undefined, // Apple returns user info in ID token
    revokeUrl: 'https://appleid.apple.com/auth/revoke',
    clientId: process.env.APPLE_CLIENT_ID!,
    clientSecret: process.env.APPLE_CLIENT_SECRET!, // Generated JWT
    scopes: ['name', 'email'],
    profileMapping: {
      id: 'sub', // From ID token
      email: 'email',
      name: 'name',
      avatar: undefined,
    },
    pkceRequired: true,
    stateRequired: true,
  },
};
```

---

## External Data Sources

### Integration Categories

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      EXTERNAL DATA SOURCE CATEGORIES                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │   FILE STORAGE  │  │  PRODUCTIVITY   │  │  COMMUNICATION  │             │
│  ├─────────────────┤  ├─────────────────┤  ├─────────────────┤             │
│  │ • OneDrive      │  │ • Jira          │  │ • Outlook       │             │
│  │ • Google Drive  │  │ • Asana         │  │ • Gmail         │             │
│  │ • SharePoint    │  │ • Notion        │  │ • Slack         │             │
│  │ • Dropbox       │  │ • Confluence    │  │ • Teams         │             │
│  │ • Box           │  │ • Linear        │  │ • Zoom          │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │   DEVELOPMENT   │  │    DATABASES    │  │      CRM        │             │
│  ├─────────────────┤  ├─────────────────┤  ├─────────────────┤             │
│  │ • GitHub        │  │ • Airtable      │  │ • Salesforce    │             │
│  │ • GitLab        │  │ • Supabase      │  │ • HubSpot       │             │
│  │ • Bitbucket     │  │ • Firebase      │  │ • Pipedrive     │             │
│  │ • Azure DevOps  │  │ • MongoDB Atlas │  │ • Zoho CRM      │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Integration Provider Configuration

```typescript
interface IntegrationProvider {
  id: string;
  name: string;
  category: 'storage' | 'productivity' | 'communication' | 'development' | 'database' | 'crm';
  icon: string;
  description: string;

  // OAuth configuration
  oauth: {
    authorizationUrl: string;
    tokenUrl: string;
    revokeUrl?: string;
    clientId: string;
    clientSecret: string;
  };

  // Available scopes with descriptions
  scopes: {
    id: string;
    name: string;
    description: string;
    required: boolean;
  }[];

  // Default scopes for connection
  defaultScopes: string[];

  // API configuration
  api: {
    baseUrl: string;
    version?: string;
    rateLimitRequests?: number;
    rateLimitWindow?: number; // seconds
  };

  // Capabilities
  capabilities: {
    listFiles?: boolean;
    readFiles?: boolean;
    writeFiles?: boolean;
    deleteFiles?: boolean;
    listItems?: boolean;
    createItems?: boolean;
    updateItems?: boolean;
    deleteItems?: boolean;
    sendMessages?: boolean;
    receiveWebhooks?: boolean;
  };

  // Token settings
  tokenSettings: {
    accessTokenLifetime?: number;  // seconds
    refreshTokenLifetime?: number; // seconds, null = never expires
    supportsRefresh: boolean;
  };
}

const INTEGRATION_PROVIDERS: Record<string, IntegrationProvider> = {
  'google-drive': {
    id: 'google-drive',
    name: 'Google Drive',
    category: 'storage',
    icon: 'google-drive',
    description: 'Access files and folders in Google Drive',

    oauth: {
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      revokeUrl: 'https://oauth2.googleapis.com/revoke',
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },

    scopes: [
      {
        id: 'https://www.googleapis.com/auth/drive.readonly',
        name: 'Read files',
        description: 'View and download files from your Google Drive',
        required: true,
      },
      {
        id: 'https://www.googleapis.com/auth/drive.file',
        name: 'Manage files',
        description: 'Create, edit, and delete files created by this app',
        required: false,
      },
      {
        id: 'https://www.googleapis.com/auth/drive',
        name: 'Full access',
        description: 'Full access to all files in your Google Drive',
        required: false,
      },
    ],

    defaultScopes: ['https://www.googleapis.com/auth/drive.readonly'],

    api: {
      baseUrl: 'https://www.googleapis.com/drive/v3',
      version: 'v3',
      rateLimitRequests: 1000,
      rateLimitWindow: 100, // per 100 seconds
    },

    capabilities: {
      listFiles: true,
      readFiles: true,
      writeFiles: true,
      deleteFiles: true,
    },

    tokenSettings: {
      accessTokenLifetime: 3600,
      refreshTokenLifetime: null, // Doesn't expire
      supportsRefresh: true,
    },
  },

  'onedrive': {
    id: 'onedrive',
    name: 'OneDrive',
    category: 'storage',
    icon: 'microsoft-onedrive',
    description: 'Access files and folders in OneDrive',

    oauth: {
      authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      revokeUrl: undefined,
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
    },

    scopes: [
      {
        id: 'Files.Read',
        name: 'Read files',
        description: 'Read your files',
        required: true,
      },
      {
        id: 'Files.ReadWrite',
        name: 'Read and write files',
        description: 'Read and write your files',
        required: false,
      },
      {
        id: 'Files.Read.All',
        name: 'Read all files',
        description: 'Read all files you can access',
        required: false,
      },
      {
        id: 'offline_access',
        name: 'Offline access',
        description: 'Maintain access when you\'re not using the app',
        required: true,
      },
    ],

    defaultScopes: ['Files.Read', 'offline_access'],

    api: {
      baseUrl: 'https://graph.microsoft.com/v1.0',
      version: 'v1.0',
      rateLimitRequests: 10000,
      rateLimitWindow: 10,
    },

    capabilities: {
      listFiles: true,
      readFiles: true,
      writeFiles: true,
      deleteFiles: true,
    },

    tokenSettings: {
      accessTokenLifetime: 3600,
      refreshTokenLifetime: 7776000, // 90 days
      supportsRefresh: true,
    },
  },

  'sharepoint': {
    id: 'sharepoint',
    name: 'SharePoint',
    category: 'storage',
    icon: 'microsoft-sharepoint',
    description: 'Access SharePoint sites, libraries, and documents',

    oauth: {
      authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      revokeUrl: undefined,
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
    },

    scopes: [
      {
        id: 'Sites.Read.All',
        name: 'Read sites',
        description: 'Read items in all site collections',
        required: true,
      },
      {
        id: 'Sites.ReadWrite.All',
        name: 'Read and write sites',
        description: 'Read and write items in all site collections',
        required: false,
      },
      {
        id: 'Files.ReadWrite.All',
        name: 'Read and write files',
        description: 'Read and write all files',
        required: false,
      },
      {
        id: 'offline_access',
        name: 'Offline access',
        description: 'Maintain access when you\'re not using the app',
        required: true,
      },
    ],

    defaultScopes: ['Sites.Read.All', 'offline_access'],

    api: {
      baseUrl: 'https://graph.microsoft.com/v1.0',
      version: 'v1.0',
    },

    capabilities: {
      listFiles: true,
      readFiles: true,
      writeFiles: true,
      deleteFiles: true,
      listItems: true,
    },

    tokenSettings: {
      accessTokenLifetime: 3600,
      refreshTokenLifetime: 7776000,
      supportsRefresh: true,
    },
  },

  'outlook': {
    id: 'outlook',
    name: 'Outlook',
    category: 'communication',
    icon: 'microsoft-outlook',
    description: 'Access emails, calendar, and contacts',

    oauth: {
      authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      revokeUrl: undefined,
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
    },

    scopes: [
      {
        id: 'Mail.Read',
        name: 'Read mail',
        description: 'Read your email',
        required: false,
      },
      {
        id: 'Mail.Send',
        name: 'Send mail',
        description: 'Send email on your behalf',
        required: false,
      },
      {
        id: 'Calendars.Read',
        name: 'Read calendars',
        description: 'Read your calendar events',
        required: false,
      },
      {
        id: 'Calendars.ReadWrite',
        name: 'Read and write calendars',
        description: 'Read and write your calendar events',
        required: false,
      },
      {
        id: 'Contacts.Read',
        name: 'Read contacts',
        description: 'Read your contacts',
        required: false,
      },
      {
        id: 'offline_access',
        name: 'Offline access',
        description: 'Maintain access when you\'re not using the app',
        required: true,
      },
    ],

    defaultScopes: ['Mail.Read', 'Calendars.Read', 'offline_access'],

    api: {
      baseUrl: 'https://graph.microsoft.com/v1.0',
      version: 'v1.0',
    },

    capabilities: {
      listItems: true,
      readFiles: true,
      sendMessages: true,
      receiveWebhooks: true,
    },

    tokenSettings: {
      accessTokenLifetime: 3600,
      refreshTokenLifetime: 7776000,
      supportsRefresh: true,
    },
  },

  'slack': {
    id: 'slack',
    name: 'Slack',
    category: 'communication',
    icon: 'slack',
    description: 'Send messages and access Slack channels',

    oauth: {
      authorizationUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      revokeUrl: 'https://slack.com/api/auth.revoke',
      clientId: process.env.SLACK_CLIENT_ID!,
      clientSecret: process.env.SLACK_CLIENT_SECRET!,
    },

    scopes: [
      {
        id: 'channels:read',
        name: 'View channels',
        description: 'View basic channel information',
        required: true,
      },
      {
        id: 'chat:write',
        name: 'Send messages',
        description: 'Send messages as the app',
        required: false,
      },
      {
        id: 'files:read',
        name: 'Read files',
        description: 'View files shared in channels',
        required: false,
      },
      {
        id: 'users:read',
        name: 'Read users',
        description: 'View people in the workspace',
        required: false,
      },
    ],

    defaultScopes: ['channels:read', 'chat:write'],

    api: {
      baseUrl: 'https://slack.com/api',
      rateLimitRequests: 100,
      rateLimitWindow: 60,
    },

    capabilities: {
      listItems: true,
      sendMessages: true,
      receiveWebhooks: true,
    },

    tokenSettings: {
      accessTokenLifetime: null, // Doesn't expire
      refreshTokenLifetime: null,
      supportsRefresh: false, // Slack tokens don't expire
    },
  },

  'jira': {
    id: 'jira',
    name: 'Jira',
    category: 'productivity',
    icon: 'jira',
    description: 'Access Jira issues, projects, and boards',

    oauth: {
      authorizationUrl: 'https://auth.atlassian.com/authorize',
      tokenUrl: 'https://auth.atlassian.com/oauth/token',
      revokeUrl: undefined,
      clientId: process.env.ATLASSIAN_CLIENT_ID!,
      clientSecret: process.env.ATLASSIAN_CLIENT_SECRET!,
    },

    scopes: [
      {
        id: 'read:jira-work',
        name: 'Read Jira',
        description: 'Read Jira project and issue data',
        required: true,
      },
      {
        id: 'write:jira-work',
        name: 'Write Jira',
        description: 'Create and edit issues',
        required: false,
      },
      {
        id: 'read:jira-user',
        name: 'Read users',
        description: 'Read user information',
        required: false,
      },
      {
        id: 'offline_access',
        name: 'Offline access',
        description: 'Maintain access when you\'re not using the app',
        required: true,
      },
    ],

    defaultScopes: ['read:jira-work', 'offline_access'],

    api: {
      baseUrl: 'https://api.atlassian.com/ex/jira',
      version: '3',
      rateLimitRequests: 100,
      rateLimitWindow: 10,
    },

    capabilities: {
      listItems: true,
      createItems: true,
      updateItems: true,
      receiveWebhooks: true,
    },

    tokenSettings: {
      accessTokenLifetime: 3600,
      refreshTokenLifetime: null,
      supportsRefresh: true,
    },
  },

  'notion': {
    id: 'notion',
    name: 'Notion',
    category: 'productivity',
    icon: 'notion',
    description: 'Access Notion pages, databases, and blocks',

    oauth: {
      authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
      tokenUrl: 'https://api.notion.com/v1/oauth/token',
      revokeUrl: undefined,
      clientId: process.env.NOTION_CLIENT_ID!,
      clientSecret: process.env.NOTION_CLIENT_SECRET!,
    },

    scopes: [], // Notion uses page-level permissions, not scopes

    defaultScopes: [],

    api: {
      baseUrl: 'https://api.notion.com/v1',
      version: '2022-06-28',
      rateLimitRequests: 3,
      rateLimitWindow: 1, // 3 requests per second
    },

    capabilities: {
      listItems: true,
      readFiles: true,
      createItems: true,
      updateItems: true,
    },

    tokenSettings: {
      accessTokenLifetime: null, // Doesn't expire
      refreshTokenLifetime: null,
      supportsRefresh: false,
    },
  },

  'github-integration': {
    id: 'github-integration',
    name: 'GitHub',
    category: 'development',
    icon: 'github',
    description: 'Access repositories, issues, and pull requests',

    oauth: {
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      revokeUrl: undefined,
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },

    scopes: [
      {
        id: 'repo',
        name: 'Repositories',
        description: 'Full control of private repositories',
        required: false,
      },
      {
        id: 'public_repo',
        name: 'Public repositories',
        description: 'Access public repositories',
        required: true,
      },
      {
        id: 'read:org',
        name: 'Read organizations',
        description: 'Read org and team membership',
        required: false,
      },
      {
        id: 'workflow',
        name: 'Workflows',
        description: 'Update GitHub Actions workflows',
        required: false,
      },
    ],

    defaultScopes: ['public_repo', 'read:org'],

    api: {
      baseUrl: 'https://api.github.com',
      rateLimitRequests: 5000,
      rateLimitWindow: 3600,
    },

    capabilities: {
      listItems: true,
      readFiles: true,
      createItems: true,
      updateItems: true,
      receiveWebhooks: true,
    },

    tokenSettings: {
      accessTokenLifetime: null, // Doesn't expire
      refreshTokenLifetime: null,
      supportsRefresh: false,
    },
  },

  'dropbox': {
    id: 'dropbox',
    name: 'Dropbox',
    category: 'storage',
    icon: 'dropbox',
    description: 'Access files and folders in Dropbox',

    oauth: {
      authorizationUrl: 'https://www.dropbox.com/oauth2/authorize',
      tokenUrl: 'https://api.dropbox.com/oauth2/token',
      revokeUrl: 'https://api.dropbox.com/2/auth/token/revoke',
      clientId: process.env.DROPBOX_CLIENT_ID!,
      clientSecret: process.env.DROPBOX_CLIENT_SECRET!,
    },

    scopes: [
      {
        id: 'files.metadata.read',
        name: 'Read metadata',
        description: 'View information about files and folders',
        required: true,
      },
      {
        id: 'files.content.read',
        name: 'Read files',
        description: 'View and download files',
        required: true,
      },
      {
        id: 'files.content.write',
        name: 'Write files',
        description: 'Edit and upload files',
        required: false,
      },
    ],

    defaultScopes: ['files.metadata.read', 'files.content.read'],

    api: {
      baseUrl: 'https://api.dropboxapi.com/2',
      rateLimitRequests: 1000,
      rateLimitWindow: 300,
    },

    capabilities: {
      listFiles: true,
      readFiles: true,
      writeFiles: true,
      deleteFiles: true,
    },

    tokenSettings: {
      accessTokenLifetime: 14400, // 4 hours
      refreshTokenLifetime: null,
      supportsRefresh: true,
    },
  },
};
```

---

## OAuth Flows

### Authorization Code Flow with PKCE

```typescript
// OAuth service implementation
import { nanoid } from 'nanoid';
import crypto from 'crypto';

interface OAuthState {
  userId: string;
  tenantId: string;
  providerId: string;
  redirectUrl: string;
  scopes: string[];
  codeVerifier?: string;
  timestamp: number;
}

class OAuthService {
  private stateStore: Map<string, OAuthState> = new Map();
  private readonly STATE_EXPIRY = 10 * 60 * 1000; // 10 minutes

  // Generate PKCE code verifier and challenge
  private generatePKCE(): { verifier: string; challenge: string } {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64url');
    return { verifier, challenge };
  }

  // Generate authorization URL
  async generateAuthUrl(
    userId: string,
    tenantId: string,
    providerId: string,
    scopes: string[],
    redirectUrl: string
  ): Promise<string> {
    const provider = INTEGRATION_PROVIDERS[providerId];
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    // Generate state
    const stateId = nanoid(32);
    const pkce = provider.oauth.authorizationUrl.includes('google') ||
                 provider.oauth.authorizationUrl.includes('microsoft')
      ? this.generatePKCE()
      : undefined;

    const state: OAuthState = {
      userId,
      tenantId,
      providerId,
      redirectUrl,
      scopes,
      codeVerifier: pkce?.verifier,
      timestamp: Date.now(),
    };

    // Store state (use Redis in production)
    this.stateStore.set(stateId, state);

    // Build authorization URL
    const params = new URLSearchParams({
      client_id: provider.oauth.clientId,
      redirect_uri: `${process.env.API_URL}/api/v1/oauth/callback`,
      response_type: 'code',
      scope: scopes.join(' '),
      state: stateId,
      access_type: 'offline', // Request refresh token
      prompt: 'consent', // Force consent screen for refresh token
    });

    // Add PKCE if supported
    if (pkce) {
      params.set('code_challenge', pkce.challenge);
      params.set('code_challenge_method', 'S256');
    }

    return `${provider.oauth.authorizationUrl}?${params.toString()}`;
  }

  // Handle OAuth callback
  async handleCallback(
    code: string,
    stateId: string
  ): Promise<OAuthConnection> {
    // Validate state
    const state = this.stateStore.get(stateId);
    if (!state) {
      throw new Error('Invalid or expired state');
    }

    if (Date.now() - state.timestamp > this.STATE_EXPIRY) {
      this.stateStore.delete(stateId);
      throw new Error('State expired');
    }

    // Clean up state
    this.stateStore.delete(stateId);

    const provider = INTEGRATION_PROVIDERS[state.providerId];

    // Exchange code for tokens
    const tokenResponse = await this.exchangeCodeForTokens(
      provider,
      code,
      state.codeVerifier
    );

    // Get user info from provider (for display name)
    const providerUserInfo = await this.getProviderUserInfo(
      provider,
      tokenResponse.access_token
    );

    // Encrypt and store tokens
    const connection = await this.createConnection({
      userId: state.userId,
      tenantId: state.tenantId,
      providerId: state.providerId,
      providerUserId: providerUserInfo.id,
      providerEmail: providerUserInfo.email,
      providerDisplayName: providerUserInfo.name,
      scopes: state.scopes,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt: tokenResponse.expires_in
        ? new Date(Date.now() + tokenResponse.expires_in * 1000)
        : undefined,
    });

    return connection;
  }

  // Exchange authorization code for tokens
  private async exchangeCodeForTokens(
    provider: IntegrationProvider,
    code: string,
    codeVerifier?: string
  ): Promise<TokenResponse> {
    const body: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      client_id: provider.oauth.clientId,
      client_secret: provider.oauth.clientSecret,
      redirect_uri: `${process.env.API_URL}/api/v1/oauth/callback`,
    };

    if (codeVerifier) {
      body.code_verifier = codeVerifier;
    }

    const response = await fetch(provider.oauth.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return response.json();
  }

  // Refresh access token
  async refreshAccessToken(connectionId: string): Promise<void> {
    const connection = await this.getConnection(connectionId);
    if (!connection.refreshToken) {
      throw new Error('No refresh token available');
    }

    const provider = INTEGRATION_PROVIDERS[connection.providerId];
    if (!provider.tokenSettings.supportsRefresh) {
      throw new Error('Provider does not support token refresh');
    }

    const response = await fetch(provider.oauth.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: await this.decryptToken(connection.refreshToken),
        client_id: provider.oauth.clientId,
        client_secret: provider.oauth.clientSecret,
      }),
    });

    if (!response.ok) {
      // Mark connection as expired
      await this.markConnectionExpired(connectionId);
      throw new Error('Token refresh failed');
    }

    const tokens: TokenResponse = await response.json();

    // Update connection with new tokens
    await this.updateConnectionTokens(connectionId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || connection.refreshToken,
      expiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : undefined,
    });
  }

  // Get valid access token (refresh if needed)
  async getValidAccessToken(connectionId: string): Promise<string> {
    const connection = await this.getConnection(connectionId);

    // Check if token is expired or will expire soon (within 5 minutes)
    const expiresAt = connection.expiresAt;
    const bufferTime = 5 * 60 * 1000; // 5 minutes

    if (expiresAt && new Date(expiresAt).getTime() - Date.now() < bufferTime) {
      await this.refreshAccessToken(connectionId);
      // Refetch connection to get new token
      const refreshedConnection = await this.getConnection(connectionId);
      return this.decryptToken(refreshedConnection.accessToken);
    }

    return this.decryptToken(connection.accessToken);
  }

  // Revoke connection
  async revokeConnection(connectionId: string): Promise<void> {
    const connection = await this.getConnection(connectionId);
    const provider = INTEGRATION_PROVIDERS[connection.providerId];

    // Revoke token at provider if supported
    if (provider.oauth.revokeUrl) {
      try {
        await fetch(provider.oauth.revokeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            token: await this.decryptToken(connection.accessToken),
          }),
        });
      } catch (error) {
        console.error('Failed to revoke token at provider:', error);
        // Continue with local deletion even if revocation fails
      }
    }

    // Delete connection from database
    await this.deleteConnection(connectionId);
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
  scope?: string;
}
```

---

## Token Management

### Token Encryption

```typescript
// Token encryption service
import crypto from 'crypto';

class TokenEncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyLength = 32;
  private readonly ivLength = 16;
  private readonly authTagLength = 16;

  private masterKey: Buffer;

  constructor() {
    const keyHex = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
    if (!keyHex || keyHex.length !== 64) {
      throw new Error('Invalid OAUTH_TOKEN_ENCRYPTION_KEY');
    }
    this.masterKey = Buffer.from(keyHex, 'hex');
  }

  // Encrypt a token
  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, this.masterKey, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  // Decrypt a token
  decrypt(ciphertext: string): string {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted token format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv(this.algorithm, this.masterKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  // Rotate encryption key (re-encrypt all tokens)
  async rotateKey(newKeyHex: string): Promise<void> {
    const newKey = Buffer.from(newKeyHex, 'hex');

    // Get all connections
    const connections = await db.select().from(oauthConnections);

    for (const connection of connections) {
      // Decrypt with old key
      const accessToken = this.decrypt(connection.accessToken);
      const refreshToken = connection.refreshToken
        ? this.decrypt(connection.refreshToken)
        : null;

      // Re-encrypt with new key
      const oldKey = this.masterKey;
      this.masterKey = newKey;

      await db
        .update(oauthConnections)
        .set({
          accessToken: this.encrypt(accessToken),
          refreshToken: refreshToken ? this.encrypt(refreshToken) : null,
          updatedAt: new Date(),
        })
        .where(eq(oauthConnections.id, connection.id));

      this.masterKey = oldKey;
    }

    // Update master key
    this.masterKey = newKey;
  }
}
```

### Token Refresh Job

```typescript
// Background job to refresh expiring tokens
import { Queue, Worker } from 'bullmq';

const tokenRefreshQueue = new Queue('token-refresh', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 60000, // 1 minute
    },
  },
});

// Schedule token refresh job
export async function scheduleTokenRefresh(
  connectionId: string,
  expiresAt: Date
): Promise<void> {
  // Refresh 10 minutes before expiry
  const refreshAt = new Date(expiresAt.getTime() - 10 * 60 * 1000);
  const delay = Math.max(0, refreshAt.getTime() - Date.now());

  await tokenRefreshQueue.add(
    'refresh',
    { connectionId },
    {
      delay,
      jobId: `refresh-${connectionId}`, // Prevent duplicates
    }
  );
}

// Token refresh worker
const tokenRefreshWorker = new Worker(
  'token-refresh',
  async (job) => {
    const { connectionId } = job.data;

    try {
      await oauthService.refreshAccessToken(connectionId);

      // Get updated connection to schedule next refresh
      const connection = await oauthService.getConnection(connectionId);
      if (connection.expiresAt) {
        await scheduleTokenRefresh(connectionId, new Date(connection.expiresAt));
      }
    } catch (error) {
      console.error(`Failed to refresh token for connection ${connectionId}:`, error);

      // Notify user that reconnection is needed
      await notificationService.send({
        userId: connection.userId,
        type: 'oauth_reconnect_required',
        data: {
          connectionId,
          providerId: connection.providerId,
          providerName: INTEGRATION_PROVIDERS[connection.providerId].name,
        },
      });

      throw error;
    }
  },
  { connection: redis }
);
```

---

## Provider Configurations

### Microsoft Azure AD App Registration

```
Azure Portal → App Registrations → New Registration

1. Name: Zygo
2. Supported account types: Accounts in any organizational directory and personal Microsoft accounts
3. Redirect URI: Web - https://api.zygo.tech/api/v1/oauth/callback

4. Certificates & Secrets:
   - New client secret
   - Description: Production
   - Expires: 24 months

5. API Permissions:
   - Microsoft Graph:
     - User.Read (Delegated)
     - Files.Read (Delegated)
     - Files.ReadWrite (Delegated)
     - Sites.Read.All (Delegated)
     - Mail.Read (Delegated)
     - Mail.Send (Delegated)
     - Calendars.Read (Delegated)
     - Calendars.ReadWrite (Delegated)
     - offline_access (Delegated)

6. Authentication:
   - Enable "Access tokens" for implicit flow (optional)
   - Enable "ID tokens" for implicit flow (optional)
```

### Google Cloud Console

```
Google Cloud Console → APIs & Services → Credentials

1. Create OAuth Client ID:
   - Application type: Web application
   - Name: Zygo Production
   - Authorized redirect URIs:
     - https://api.zygo.tech/api/v1/oauth/callback
     - https://api.zygo.tech/api/v1/auth/oauth/google/callback

2. OAuth consent screen:
   - User Type: External
   - App name: Zygo
   - Support email: support@zygo.tech
   - Scopes:
     - openid
     - profile
     - email
     - https://www.googleapis.com/auth/drive.readonly
     - https://www.googleapis.com/auth/drive.file
     - https://www.googleapis.com/auth/calendar.readonly
     - https://www.googleapis.com/auth/calendar.events

3. Enable APIs:
   - Google Drive API
   - Google Calendar API
   - Google+ API (for profile)
```

### GitHub OAuth App

```
GitHub → Settings → Developer Settings → OAuth Apps → New OAuth App

1. Application name: Zygo
2. Homepage URL: https://zygo.tech
3. Authorization callback URL: https://api.zygo.tech/api/v1/oauth/callback
4. Enable Device Flow: No

After creation:
- Copy Client ID
- Generate new client secret
```

### Slack App

```
Slack API → Your Apps → Create New App

1. From scratch
2. App Name: Zygo
3. Pick a workspace (for development)

4. OAuth & Permissions:
   - Redirect URLs:
     - https://api.zygo.tech/api/v1/oauth/callback

   - Bot Token Scopes:
     - channels:read
     - chat:write
     - files:read
     - users:read

   - User Token Scopes:
     - channels:read
     - chat:write
     - files:read

5. App Home:
   - Enable "Messages Tab"

6. Install to Workspace
```

### Atlassian (Jira/Confluence)

```
Atlassian Developer Console → Create App

1. App Name: Zygo
2. Base URL: https://zygo.tech

3. Permissions:
   - Jira:
     - read:jira-work
     - write:jira-work
     - read:jira-user
   - Confluence:
     - read:confluence-content.all
     - write:confluence-content

4. Authorization:
   - Callback URL: https://api.zygo.tech/api/v1/oauth/callback

5. Consent screen:
   - Description: Zygo workflow automation
```

---

## Database Schema

### OAuth Tables

```sql
-- OAuth connections (external integrations)
CREATE TABLE oauth_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Provider info
    provider_id VARCHAR(50) NOT NULL,
    provider_user_id VARCHAR(255),
    provider_email VARCHAR(255),
    provider_display_name VARCHAR(255),

    -- Granted scopes
    scopes TEXT[] NOT NULL DEFAULT '{}',

    -- Encrypted tokens
    access_token TEXT NOT NULL,
    refresh_token TEXT,

    -- Token metadata
    token_type VARCHAR(50) DEFAULT 'Bearer',
    expires_at TIMESTAMPTZ,

    -- Connection status
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    -- active, expired, revoked, error

    -- Error info (if status = error)
    last_error TEXT,
    last_error_at TIMESTAMPTZ,

    -- Metadata
    metadata JSONB DEFAULT '{}',

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,

    -- Constraints
    UNIQUE(tenant_id, user_id, provider_id),
    CONSTRAINT valid_status CHECK (status IN ('active', 'expired', 'revoked', 'error'))
);

-- Indexes
CREATE INDEX idx_oauth_connections_tenant ON oauth_connections(tenant_id);
CREATE INDEX idx_oauth_connections_user ON oauth_connections(user_id);
CREATE INDEX idx_oauth_connections_provider ON oauth_connections(provider_id);
CREATE INDEX idx_oauth_connections_status ON oauth_connections(status);
CREATE INDEX idx_oauth_connections_expires ON oauth_connections(expires_at)
    WHERE status = 'active' AND expires_at IS NOT NULL;

-- RLS policies
ALTER TABLE oauth_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY oauth_connections_tenant_isolation ON oauth_connections
    FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY oauth_connections_user_access ON oauth_connections
    FOR ALL USING (
        user_id = current_setting('app.user_id')::uuid
        OR EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN role_permissions rp ON ur.role_id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE ur.user_id = current_setting('app.user_id')::uuid
            AND p.key = 'canManageIntegrations'
        )
    );


-- OAuth state (temporary, for CSRF protection)
CREATE TABLE oauth_states (
    id VARCHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    provider_id VARCHAR(50) NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT '{}',
    redirect_url TEXT,
    code_verifier TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes')
);

-- Auto-cleanup expired states
CREATE INDEX idx_oauth_states_expires ON oauth_states(expires_at);


-- OAuth audit log
CREATE TABLE oauth_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    user_id UUID REFERENCES users(id),
    connection_id UUID REFERENCES oauth_connections(id),

    -- Event info
    event_type VARCHAR(50) NOT NULL,
    -- authorize_started, authorize_completed, authorize_failed,
    -- token_refreshed, token_refresh_failed, connection_revoked,
    -- api_call, api_call_failed

    provider_id VARCHAR(50) NOT NULL,

    -- Details
    details JSONB DEFAULT '{}',

    -- Request context
    ip_address INET,
    user_agent TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_oauth_audit_tenant ON oauth_audit_log(tenant_id);
CREATE INDEX idx_oauth_audit_user ON oauth_audit_log(user_id);
CREATE INDEX idx_oauth_audit_connection ON oauth_audit_log(connection_id);
CREATE INDEX idx_oauth_audit_created ON oauth_audit_log(created_at);


-- Social login connections (for SSO)
CREATE TABLE social_logins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Provider info
    provider VARCHAR(20) NOT NULL,
    -- google, github, microsoft, apple

    provider_user_id VARCHAR(255) NOT NULL,
    provider_email VARCHAR(255),

    -- Profile data (not sensitive)
    profile_data JSONB DEFAULT '{}',

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,

    UNIQUE(provider, provider_user_id),
    UNIQUE(user_id, provider)
);

CREATE INDEX idx_social_logins_user ON social_logins(user_id);
CREATE INDEX idx_social_logins_provider ON social_logins(provider, provider_user_id);
```

### Drizzle Schema

```typescript
// src/db/schema/oauth.ts
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  inet,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { tenants } from './tenants';

export const oauthConnections = pgTable('oauth_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  providerId: varchar('provider_id', { length: 50 }).notNull(),
  providerUserId: varchar('provider_user_id', { length: 255 }),
  providerEmail: varchar('provider_email', { length: 255 }),
  providerDisplayName: varchar('provider_display_name', { length: 255 }),

  scopes: text('scopes').array().notNull().default([]),

  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  tokenType: varchar('token_type', { length: 50 }).default('Bearer'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),

  status: varchar('status', { length: 20 }).notNull().default('active'),
  lastError: text('last_error'),
  lastErrorAt: timestamp('last_error_at', { withTimezone: true }),

  metadata: jsonb('metadata').default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
}, (table) => ({
  tenantIdx: index('idx_oauth_connections_tenant').on(table.tenantId),
  userIdx: index('idx_oauth_connections_user').on(table.userId),
  providerIdx: index('idx_oauth_connections_provider').on(table.providerId),
  uniqueConnection: uniqueIndex('idx_oauth_connections_unique')
    .on(table.tenantId, table.userId, table.providerId),
}));

export const oauthConnectionsRelations = relations(oauthConnections, ({ one }) => ({
  tenant: one(tenants, {
    fields: [oauthConnections.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [oauthConnections.userId],
    references: [users.id],
  }),
}));

export const socialLogins = pgTable('social_logins', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  provider: varchar('provider', { length: 20 }).notNull(),
  providerUserId: varchar('provider_user_id', { length: 255 }).notNull(),
  providerEmail: varchar('provider_email', { length: 255 }),

  profileData: jsonb('profile_data').default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
}, (table) => ({
  userIdx: index('idx_social_logins_user').on(table.userId),
  providerIdx: uniqueIndex('idx_social_logins_provider')
    .on(table.provider, table.providerUserId),
  userProviderIdx: uniqueIndex('idx_social_logins_user_provider')
    .on(table.userId, table.provider),
}));

export type OAuthConnection = typeof oauthConnections.$inferSelect;
export type NewOAuthConnection = typeof oauthConnections.$inferInsert;
export type SocialLogin = typeof socialLogins.$inferSelect;
export type NewSocialLogin = typeof socialLogins.$inferInsert;
```

---

## API Endpoints

### Authentication OAuth Endpoints

```
# SSO Login
GET  /api/v1/auth/oauth/:provider                    # Start SSO login
GET  /api/v1/auth/oauth/:provider/callback           # SSO callback
POST /api/v1/auth/oauth/:provider/unlink             # Unlink social login
GET  /api/v1/auth/oauth/providers                    # List available SSO providers
```

### Integration OAuth Endpoints

```
# Connection management
GET    /api/v1/oauth/providers                       # List available integrations
GET    /api/v1/oauth/connections                     # List user's connections
GET    /api/v1/oauth/connections/:id                 # Get connection details
DELETE /api/v1/oauth/connections/:id                 # Revoke connection

# OAuth flow
GET    /api/v1/oauth/authorize                       # Start OAuth flow
GET    /api/v1/oauth/callback                        # OAuth callback

# Token operations
POST   /api/v1/oauth/connections/:id/refresh         # Force token refresh
POST   /api/v1/oauth/connections/:id/test            # Test connection
```

### API Specification

```typescript
// GET /api/v1/oauth/providers
interface ListProvidersResponse {
  providers: {
    id: string;
    name: string;
    category: string;
    icon: string;
    description: string;
    scopes: {
      id: string;
      name: string;
      description: string;
      required: boolean;
    }[];
    capabilities: Record<string, boolean>;
  }[];
}

// GET /api/v1/oauth/connections
interface ListConnectionsResponse {
  connections: {
    id: string;
    providerId: string;
    providerName: string;
    providerEmail?: string;
    providerDisplayName?: string;
    scopes: string[];
    status: 'active' | 'expired' | 'revoked' | 'error';
    lastError?: string;
    createdAt: string;
    lastUsedAt?: string;
  }[];
}

// GET /api/v1/oauth/authorize
interface AuthorizeRequest {
  provider: string;           // Provider ID
  scopes?: string[];          // Override default scopes
  redirectUrl?: string;       // Where to redirect after success
}

interface AuthorizeResponse {
  authorizationUrl: string;   // URL to redirect user to
}

// POST /api/v1/oauth/connections/:id/test
interface TestConnectionResponse {
  success: boolean;
  latencyMs: number;
  providerInfo?: {
    email?: string;
    name?: string;
    quotaUsed?: number;
    quotaTotal?: number;
  };
  error?: string;
}
```

### Route Implementation

```typescript
// src/routes/oauth/index.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppContext } from '../../types/context';
import { authMiddleware } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { oauthService } from '../../services/oauth.service';
import { INTEGRATION_PROVIDERS } from '../../config/oauth-providers';

const app = new Hono<AppContext>();

// All routes require auth
app.use('*', authMiddleware);
app.use('*', tenantMiddleware);

// List available providers
app.get('/providers', async (c) => {
  const providers = Object.values(INTEGRATION_PROVIDERS).map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    icon: p.icon,
    description: p.description,
    scopes: p.scopes,
    capabilities: p.capabilities,
  }));

  return c.json({ providers });
});

// List user's connections
app.get('/connections', async (c) => {
  const user = c.get('user')!;
  const tenant = c.get('tenant')!;

  const connections = await oauthService.listConnections(user.id, tenant.id);

  return c.json({
    connections: connections.map((conn) => ({
      id: conn.id,
      providerId: conn.providerId,
      providerName: INTEGRATION_PROVIDERS[conn.providerId]?.name || conn.providerId,
      providerEmail: conn.providerEmail,
      providerDisplayName: conn.providerDisplayName,
      scopes: conn.scopes,
      status: conn.status,
      lastError: conn.lastError,
      createdAt: conn.createdAt,
      lastUsedAt: conn.lastUsedAt,
    })),
  });
});

// Start OAuth authorization
const authorizeSchema = z.object({
  provider: z.string(),
  scopes: z.array(z.string()).optional(),
  redirectUrl: z.string().url().optional(),
});

app.get(
  '/authorize',
  zValidator('query', authorizeSchema),
  async (c) => {
    const user = c.get('user')!;
    const tenant = c.get('tenant')!;
    const { provider, scopes, redirectUrl } = c.req.valid('query');

    const providerConfig = INTEGRATION_PROVIDERS[provider];
    if (!providerConfig) {
      return c.json({ error: 'Unknown provider' }, 400);
    }

    const effectiveScopes = scopes || providerConfig.defaultScopes;

    const authorizationUrl = await oauthService.generateAuthUrl(
      user.id,
      tenant.id,
      provider,
      effectiveScopes,
      redirectUrl || `${process.env.APP_URL}/settings/integrations`
    );

    return c.json({ authorizationUrl });
  }
);

// OAuth callback
app.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  if (error) {
    // Redirect to error page
    const errorUrl = new URL(`${process.env.APP_URL}/settings/integrations`);
    errorUrl.searchParams.set('error', error);
    errorUrl.searchParams.set('error_description', c.req.query('error_description') || '');
    return c.redirect(errorUrl.toString());
  }

  if (!code || !state) {
    return c.redirect(`${process.env.APP_URL}/settings/integrations?error=missing_params`);
  }

  try {
    const connection = await oauthService.handleCallback(code, state);

    // Redirect to success page
    const successUrl = new URL(`${process.env.APP_URL}/settings/integrations`);
    successUrl.searchParams.set('connected', connection.providerId);
    return c.redirect(successUrl.toString());
  } catch (error) {
    console.error('OAuth callback error:', error);
    return c.redirect(`${process.env.APP_URL}/settings/integrations?error=callback_failed`);
  }
});

// Revoke connection
app.delete('/connections/:id', async (c) => {
  const user = c.get('user')!;
  const connectionId = c.req.param('id');

  await oauthService.revokeConnection(connectionId, user.id);

  return c.json({ success: true });
});

// Test connection
app.post('/connections/:id/test', async (c) => {
  const connectionId = c.req.param('id');

  const startTime = Date.now();
  try {
    const providerInfo = await oauthService.testConnection(connectionId);
    return c.json({
      success: true,
      latencyMs: Date.now() - startTime,
      providerInfo,
    });
  } catch (error) {
    return c.json({
      success: false,
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Force token refresh
app.post('/connections/:id/refresh', async (c) => {
  const connectionId = c.req.param('id');

  try {
    await oauthService.refreshAccessToken(connectionId);
    return c.json({ success: true });
  } catch (error) {
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Refresh failed' },
      400
    );
  }
});

export default app;
```

---

## Security Considerations

### Token Security

```typescript
// Security best practices
const SECURITY_CONFIG = {
  // PKCE for all providers that support it
  usePKCE: true,

  // State parameter for CSRF protection
  useState: true,
  stateExpiry: 10 * 60 * 1000, // 10 minutes

  // Token encryption
  tokenEncryption: {
    algorithm: 'aes-256-gcm',
    keyRotationDays: 90,
  },

  // Token storage
  tokenStorage: {
    encryptAtRest: true,
    // Never log tokens
    neverLog: ['access_token', 'refresh_token', 'client_secret'],
  },

  // Callback validation
  callbackValidation: {
    // Only allow registered redirect URIs
    strictRedirectUri: true,
    // Validate state on every callback
    validateState: true,
  },
};
```

### Secure Headers

```typescript
// OAuth callback security headers
const oauthSecurityHeaders = {
  'Content-Security-Policy': "default-src 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
};
```

### Audit Logging

```typescript
// Log all OAuth operations
async function logOAuthEvent(
  tenantId: string,
  userId: string,
  eventType: string,
  providerId: string,
  details: Record<string, unknown>,
  request: Request
): Promise<void> {
  await db.insert(oauthAuditLog).values({
    tenantId,
    userId,
    eventType,
    providerId,
    details,
    ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0] || null,
    userAgent: request.headers.get('user-agent') || null,
  });
}

// Event types to log
const OAUTH_AUDIT_EVENTS = [
  'authorize_started',
  'authorize_completed',
  'authorize_failed',
  'token_refreshed',
  'token_refresh_failed',
  'connection_revoked',
  'api_call',
  'api_call_failed',
];
```

---

## UI Components

### Integrations Settings Page

```typescript
// Frontend component structure
interface IntegrationConnection {
  id: string;
  providerId: string;
  providerName: string;
  providerIcon: string;
  providerEmail?: string;
  status: 'active' | 'expired' | 'error';
  lastUsedAt?: string;
  scopes: string[];
}

interface IntegrationProvider {
  id: string;
  name: string;
  icon: string;
  description: string;
  category: string;
  scopes: {
    id: string;
    name: string;
    description: string;
    required: boolean;
  }[];
}

// Page sections
const IntegrationsPage = () => {
  return (
    <div>
      {/* Connected Integrations */}
      <ConnectedIntegrations />

      {/* Available Integrations by Category */}
      <AvailableIntegrations category="storage" title="File Storage" />
      <AvailableIntegrations category="productivity" title="Productivity" />
      <AvailableIntegrations category="communication" title="Communication" />
      <AvailableIntegrations category="development" title="Development" />
    </div>
  );
};
```

### Connection Flow Modal

```typescript
// Connection modal with scope selection
interface ConnectModalProps {
  provider: IntegrationProvider;
  onConnect: (scopes: string[]) => void;
  onCancel: () => void;
}

const ConnectModal = ({ provider, onConnect, onCancel }: ConnectModalProps) => {
  const [selectedScopes, setSelectedScopes] = useState<string[]>(
    provider.scopes.filter(s => s.required).map(s => s.id)
  );

  return (
    <Modal>
      <ModalHeader>
        <ProviderIcon icon={provider.icon} />
        <h2>Connect {provider.name}</h2>
      </ModalHeader>

      <ModalBody>
        <p>{provider.description}</p>

        <h3>Permissions</h3>
        <ScopeList>
          {provider.scopes.map(scope => (
            <ScopeItem key={scope.id}>
              <Checkbox
                checked={selectedScopes.includes(scope.id)}
                disabled={scope.required}
                onChange={(checked) => {
                  if (checked) {
                    setSelectedScopes([...selectedScopes, scope.id]);
                  } else {
                    setSelectedScopes(selectedScopes.filter(s => s !== scope.id));
                  }
                }}
              />
              <div>
                <strong>{scope.name}</strong>
                {scope.required && <Badge>Required</Badge>}
                <p>{scope.description}</p>
              </div>
            </ScopeItem>
          ))}
        </ScopeList>
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={() => onConnect(selectedScopes)}>
          Connect {provider.name}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
```

---

## Error Handling

### OAuth Error Types

```typescript
enum OAuthErrorCode {
  // Authorization errors
  INVALID_PROVIDER = 'oauth_invalid_provider',
  INVALID_STATE = 'oauth_invalid_state',
  STATE_EXPIRED = 'oauth_state_expired',
  INVALID_SCOPE = 'oauth_invalid_scope',

  // Token errors
  TOKEN_EXCHANGE_FAILED = 'oauth_token_exchange_failed',
  TOKEN_REFRESH_FAILED = 'oauth_token_refresh_failed',
  TOKEN_REVOKE_FAILED = 'oauth_token_revoke_failed',
  TOKEN_EXPIRED = 'oauth_token_expired',
  TOKEN_INVALID = 'oauth_token_invalid',

  // Provider errors
  PROVIDER_UNAVAILABLE = 'oauth_provider_unavailable',
  PROVIDER_RATE_LIMITED = 'oauth_provider_rate_limited',
  PROVIDER_ERROR = 'oauth_provider_error',

  // User errors
  USER_DENIED = 'oauth_user_denied',
  CONNECTION_EXISTS = 'oauth_connection_exists',
  CONNECTION_NOT_FOUND = 'oauth_connection_not_found',
}

// Error response mapping
const OAUTH_ERROR_MESSAGES: Record<OAuthErrorCode, { status: number; message: string }> = {
  [OAuthErrorCode.INVALID_PROVIDER]: {
    status: 400,
    message: 'Invalid or unsupported OAuth provider',
  },
  [OAuthErrorCode.INVALID_STATE]: {
    status: 400,
    message: 'Invalid OAuth state parameter',
  },
  [OAuthErrorCode.STATE_EXPIRED]: {
    status: 400,
    message: 'OAuth authorization expired. Please try again.',
  },
  [OAuthErrorCode.TOKEN_EXCHANGE_FAILED]: {
    status: 500,
    message: 'Failed to exchange authorization code for tokens',
  },
  [OAuthErrorCode.TOKEN_REFRESH_FAILED]: {
    status: 500,
    message: 'Failed to refresh access token. Please reconnect.',
  },
  [OAuthErrorCode.USER_DENIED]: {
    status: 400,
    message: 'Authorization was denied by the user',
  },
  [OAuthErrorCode.CONNECTION_EXISTS]: {
    status: 409,
    message: 'A connection to this provider already exists',
  },
  // ... more error mappings
};
```

---

## Testing & Development

### Mock OAuth Provider

```typescript
// For local development without real OAuth
const MOCK_OAUTH_ENABLED = process.env.NODE_ENV === 'development';

if (MOCK_OAUTH_ENABLED) {
  // Mock authorization endpoint
  app.get('/mock/oauth/authorize', (c) => {
    const state = c.req.query('state');
    const redirectUri = c.req.query('redirect_uri');

    // Show mock consent screen
    return c.html(`
      <html>
        <body>
          <h1>Mock OAuth Consent</h1>
          <form action="/mock/oauth/callback" method="get">
            <input type="hidden" name="state" value="${state}" />
            <input type="hidden" name="redirect_uri" value="${redirectUri}" />
            <button type="submit" name="action" value="approve">Approve</button>
            <button type="submit" name="action" value="deny">Deny</button>
          </form>
        </body>
      </html>
    `);
  });

  // Mock callback
  app.get('/mock/oauth/callback', (c) => {
    const state = c.req.query('state');
    const redirectUri = c.req.query('redirect_uri');
    const action = c.req.query('action');

    if (action === 'deny') {
      return c.redirect(`${redirectUri}?error=access_denied&state=${state}`);
    }

    const code = 'mock_auth_code_' + Date.now();
    return c.redirect(`${redirectUri}?code=${code}&state=${state}`);
  });

  // Mock token endpoint
  app.post('/mock/oauth/token', async (c) => {
    return c.json({
      access_token: 'mock_access_token_' + Date.now(),
      refresh_token: 'mock_refresh_token_' + Date.now(),
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'read write',
    });
  });
}
```

### Integration Tests

```typescript
// tests/integration/oauth.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../../src/app';
import { createTestUser, createTestTenant, getAuthToken } from '../factories';

describe('OAuth API', () => {
  let tenant: any;
  let user: any;
  let authToken: string;

  beforeEach(async () => {
    tenant = await createTestTenant();
    user = await createTestUser(tenant.id);
    authToken = await getAuthToken(user);
  });

  describe('GET /api/v1/oauth/providers', () => {
    it('should list available providers', async () => {
      const res = await app.request('/api/v1/oauth/providers', {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.providers).toBeDefined();
      expect(body.providers.length).toBeGreaterThan(0);
      expect(body.providers[0]).toHaveProperty('id');
      expect(body.providers[0]).toHaveProperty('name');
      expect(body.providers[0]).toHaveProperty('scopes');
    });
  });

  describe('GET /api/v1/oauth/authorize', () => {
    it('should generate authorization URL', async () => {
      const res = await app.request(
        '/api/v1/oauth/authorize?provider=google-drive',
        { headers: { Authorization: `Bearer ${authToken}` } }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.authorizationUrl).toBeDefined();
      expect(body.authorizationUrl).toContain('accounts.google.com');
      expect(body.authorizationUrl).toContain('state=');
    });

    it('should return 400 for unknown provider', async () => {
      const res = await app.request(
        '/api/v1/oauth/authorize?provider=unknown',
        { headers: { Authorization: `Bearer ${authToken}` } }
      );

      expect(res.status).toBe(400);
    });
  });
});
```

---

## Environment Variables

```bash
# OAuth Token Encryption
OAUTH_TOKEN_ENCRYPTION_KEY=your-64-char-hex-key-for-aes-256

# Google OAuth
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx

# Microsoft OAuth (Azure AD)
MICROSOFT_CLIENT_ID=xxx
MICROSOFT_CLIENT_SECRET=xxx
MICROSOFT_TENANT_ID=common

# GitHub OAuth
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx

# Apple OAuth
APPLE_CLIENT_ID=xxx
APPLE_TEAM_ID=xxx
APPLE_KEY_ID=xxx
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"

# Slack OAuth
SLACK_CLIENT_ID=xxx
SLACK_CLIENT_SECRET=xxx
SLACK_SIGNING_SECRET=xxx

# Atlassian (Jira/Confluence)
ATLASSIAN_CLIENT_ID=xxx
ATLASSIAN_CLIENT_SECRET=xxx

# Notion
NOTION_CLIENT_ID=xxx
NOTION_CLIENT_SECRET=xxx

# Dropbox
DROPBOX_CLIENT_ID=xxx
DROPBOX_CLIENT_SECRET=xxx
```

---

## Changelog

### v1.0.0 (January 26, 2026)
- Initial OAuth strategy specification
- SSO authentication providers (Google, GitHub, Microsoft, Apple)
- External integrations (OneDrive, Google Drive, SharePoint, Outlook, Slack, Jira, Notion, etc.)
- OAuth 2.0 with PKCE support
- Token encryption and management
- Provider configurations
- Database schema with RLS
- API endpoints specification
- Security considerations
- UI component guidelines
- Testing and development tools
