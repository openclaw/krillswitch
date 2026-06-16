export type OutputOptions = {
  json: boolean;
};

export type ConfigOptions = {
  baseUrl: string | undefined;
  token: string | undefined;
};

export type CommonOptions = OutputOptions & ConfigOptions;

export type ProjectEnvOptions = CommonOptions & {
  project: string;
  env: string;
};

export type FlagsToggleOptions = ProjectEnvOptions & {
  on: boolean;
  off: boolean;
};

export type FlagsCreateOptions = CommonOptions & {
  project: string;
  kind: string;
  name: string | undefined;
  variations: string[];
  defaultIndex: string | undefined;
  offIndex: string | undefined;
  enabled: boolean;
};

export type FlagsTargetingOptions = ProjectEnvOptions & {
  targeting: string;
};

export type EvalOptions = ProjectEnvOptions & {
  key: string;
  attrs: string[];
};

export type LogTailOptions = CommonOptions & {
  flagKey: string | undefined;
  project: string | undefined;
  limit: string | undefined;
};

export type OnboardOptions = CommonOptions & {
  skipVerify: boolean;
};
