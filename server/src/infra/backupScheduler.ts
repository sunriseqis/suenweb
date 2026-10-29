import type { BackupService } from './backupService.ts';
import type { Logger } from './logger.ts';

/** 每小时检查一次：跨天且已配置 WebDAV 时执行自动备份（BAK-02） */
function localDate(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** 每小时检查一次：跨天且已配置 WebDAV 时执行自动备份（BAK-02）；跨天按 config.tz 的本地日期判断 */
export function startBackupScheduler(backup: BackupService, log: Logger, tz: string): () => void {
  let lastDay = localDate(tz);
  const timer = setInterval(() => {
    void (async () => {
      const today = localDate(tz);
      if (today === lastDay) return;
      lastDay = today;
      try {
        const status = await backup.status();
        if (!status.configured) return;
        const result = await backup.runBackup('auto');
        log.info({ file: result.file, size: result.size, rotated: result.rotated }, '自动备份完成');
      } catch (err) {
        log.error({ err }, '自动备份失败');
      }
    })();
  }, 60 * 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}
