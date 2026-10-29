/*
 * The model you pick sticks for new tasks, but never carries into a reply to
 * someone already working. A "go" to a conversation started on Opus once
 * resumed it on Haiku because Haiku was the last pick, and the rest of the
 * feature was built and committed on the smaller model. A reply starts on
 * Default each time; picking a model for it applies to that message only.
 */
export function startingModel<T extends string>(replying: boolean, remembered: T): T | 'default' {
  return replying ? 'default' : remembered
}

export function rememberModel(replying: boolean): boolean {
  return !replying
}
