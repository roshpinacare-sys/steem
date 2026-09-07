export interface AuthorizedProvider {
  readonly credentialDigest: string;
}

export interface ProviderAuthorizer {
  authorize(input: {
    readonly providerId: string;
    readonly providerKeyId: string;
    readonly model: string;
    readonly tenantId: string;
    readonly at: string;
  }): AuthorizedProvider;
}
