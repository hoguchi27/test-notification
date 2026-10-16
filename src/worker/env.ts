import type { Me } from "../shared/types";

export type Env = {
  DB: D1Database;
  APP_URL: string;
};

export type AppEnv = {
  Bindings: Env;
  Variables: { user: Me };
};
