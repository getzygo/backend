/**
 * OAuth types for authentication signup flow
 */

export type OAuthProvider = 'google' | 'github';

export interface OAuthCallbackRequest {
  code: string;
  provider: OAuthProvider;
  redirectUri: string;
}

export interface OAuthCallbackResponse {
  email: string;
  name?: string;
  oauthToken: string;
}

export interface OAuthSignupRequest {
  provider: OAuthProvider;
  oauthToken: string;
  email: string;
  password: string;
  termsAccepted: boolean;
  termsVersion: string;
}

export interface OAuthSignupResponse {
  success: boolean;
  userId: string;
}

export interface OAuthUserInfo {
  id: string;
  email: string;
  name?: string;
  avatar?: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType: string;
}

export interface OAuthPendingSignup {
  provider: OAuthProvider;
  providerUserId: string;
  email: string;
  name?: string;
  createdAt: number;
}
