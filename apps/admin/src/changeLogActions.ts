/** Plain-language labels for change-log action codes, shared by the list and
 *  the entry detail page. Unknown codes fall back to the raw code. */
export const ACTION_LABELS: Record<string, string> = {
  "flag.toggle": "Flag toggled",
  "flag.update": "Flag updated",
  "flag.create": "Flag created",
  "flag.archive": "Flag archived",
  "flag.restore": "Flag restored",
  "flag.delete": "Flag deleted",
  "role.set": "Role changed",
  "project.create": "Project created",
  "environment.create": "Environment created",
  "environment.delete": "Environment deleted",
  "key.rotate": "Key rotated",
  "token.mint": "Token minted",
  "token.revoke": "Token revoked",
  "segment.create": "Segment created",
  "segment.update": "Segment updated",
  "segment.delete": "Segment deleted",
  "webhook.create": "Webhook added",
  "webhook.update": "Webhook updated",
  "webhook.delete": "Webhook removed",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}
