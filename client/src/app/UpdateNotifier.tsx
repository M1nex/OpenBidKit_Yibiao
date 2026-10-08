import { useEffect, useRef } from 'react';
import { useToast } from '../shared/ui';
import type { PluginUpdateInfo } from '../shared/types/ipc';
import { hasPromptedUpdate, showUpdateReadyToast } from '../shared/updateToast';

const updatePollIntervalMs = 30 * 60 * 1000;

/**
 * 应用更新与插件升级提示。
 *
 * 本地二开：原有的「远程公告」弹窗（从 analytics.agnet.top/notice 拉取并以弹窗
 * 展示二维码等内容）已整体移除，打开客户端不会再弹出公告弹窗；应用更新提示与
 * 插件升级提示的逻辑保持不变。
 */
function UpdateNotifier() {
  const { showToast, dismissToast } = useToast();
  const updateCheckingRef = useRef(false);
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

    const checkUpdate = async () => {
      if (updateCheckingRef.current) {
        return;
      }
      updateCheckingRef.current = true;
      try {
        const result = await window.yibiao?.checkUpdate();
        if (!result?.enabled) {
          return;
        }
        if (disposed || !result.updateAvailable || !result.downloaded || !result.version) {
          return;
        }
        if (hasPromptedUpdate(result.version)) {
          return;
        }
        showUpdateReadyToast(showToast, result.version);
      } catch {
        // 自动检查失败不打扰用户，手动检查入口会展示错误。
      } finally {
        updateCheckingRef.current = false;
      }
    };

    void checkUpdate();
    const timer = disposed ? undefined : window.setInterval(() => {
      void checkUpdate();
    }, updatePollIntervalMs);

    return () => {
      disposed = true;
      if (timer !== undefined) {
        window.clearInterval(timer);
      }
      unsubscribePluginUpdates?.();
    };
  }, [dismissToast, showToast]);

  return null;
}

export default UpdateNotifier;
