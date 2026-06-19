CREATE TRIGGER `prevent_last_admin_role_change`
BEFORE UPDATE OF `role` ON `role_grants`
WHEN OLD.`role` = 'admin'
  AND NEW.`role` <> 'admin'
  AND (SELECT COUNT(*) FROM `role_grants` WHERE `role` = 'admin') <= 1
BEGIN
  SELECT RAISE(ABORT, 'last_admin');
END;
--> statement-breakpoint
CREATE TRIGGER `prevent_last_admin_role_delete`
BEFORE DELETE ON `role_grants`
WHEN OLD.`role` = 'admin'
  AND (SELECT COUNT(*) FROM `role_grants` WHERE `role` = 'admin') <= 1
BEGIN
  SELECT RAISE(ABORT, 'last_admin');
END;
