import type { Env } from "../_lib/env";
import { handleLists } from "../_lib/lists";

export const onRequest: PagesFunction<Env> = (context) =>
  handleLists(context.request, context.env, (promise) => context.waitUntil(promise));
