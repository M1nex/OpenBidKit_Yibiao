import { useEffect, useRef } from 'react';
import { useToast } from '../shared/ui';
import type { PluginUpdateInfo } from '../shared/types/ipc';

/**
 * 插件升级提示。
 *
 * 本地二开：
 * - 原有的「远程公告」弹窗已整体移除（见历史提交），打开客户端不再弹公告；
 * - 原有的自动检查更新与「新版本已下载，可重启安装」提示一并移除，客户端不会再在
 *   后台下载官方版本，也就不会把本地二开版本替换成官方版本。设置页里的手动检查
 *   更新入口保留，需要时仍可手动检查。
 */
function UpdateNotifier() {
  const { showToast, dismissToast } = useToast();
  const pluginUpdateRunningRef = useRef(false);
  const promptedPluginUpdatesRef = useRef(new Set<string>());

  useEffect(() => {
    let disposed = false;

    const promptPluginUpdates = (updates: PluginUpdateInfo[]) => {
      if (disposed || updates.length === 0) return;
      const signature = updates
        .map((plugin) => `${plugin.id}@${plugin.version}`)
        .sort()
        .join('|');
      if (promptedPluginUpdatesRef.current.has(signature)) return;
      promptedPluginUpdatesRef.current.add(signature);

      const pluginSummary = updates
        .map((plugin) => `${plugin.name} ${plugin.installedVersion} → ${plugin.version}`)
        .join('；');
      showToast(`发现 ${updates.length} 个插件可升级：${pluginSummary}`, 'info', {
        title: '插件更新可用',
        persistent: true,
        actions: [
          {
            label: '升级全部',
            variant: 'primary',
            onClick: async () => {
              if (pluginUpdateRunningRef.current) return;
              pluginUpdateRunningRef.current = true;
              const progressToastId = showToast(`正在升级 ${updates.length} 个插件，请稍候...`, 'info', {
                title: '正在升级插件',
                persistent: true,
              });
              try {
                const result = await window.yibiao?.plugins.updateAll();
                dismissToast(progressToastId);
                window.dispatchEvent(new Event('yibiao:plugins-changed'));
                if (!result || result.results.length === 0) {
                  showToast('插件已是最新版本', 'success');
                  return;
                }

                const succeeded = result.results.filter((item) => item.success);
                const failed = result.results.filter((item) => !item.success);
                if (failed.length === 0) {
                  showToast(`已成功升级 ${succeeded.length} 个插件，无需重启软件。`, 'success');
                  return;
                }

                const failedNames = failed.map((item) => item.name).join('、');
                showToast(`成功 ${succeeded.length} 个，失败 ${failed.length} 个：${failedNames}`, 'error', {
                  title: '插件升级完成',
                });
              } catch (error) {
                dismissToast(progressToastId);
                window.dispatchEvent(new Event('yibiao:plugins-changed'));
                showToast(error instanceof Error ? error.message : '批量升级插件失败', 'error');
              } finally {
                pluginUpdateRunningRef.current = false;
              }
            },
          },
          { label: '稍后' },
        ],
      });
    };

    const unsubscribePluginUpdates = window.yibiao?.onPluginUpdatesAvailable(promptPluginUpdates);

    return () => {
      disposed = true;
      unsubscribePluginUpdates?.();
    };
  }, [dismissToast, showToast]);

  return null;
}

export default UpdateNotifier;
