import type { JSX } from 'react'
import { useActiveTab, useAppStore } from '../store/useAppStore'
import { useOpenPanels, useUiStore } from '../store/useUiStore'
import { send } from '../lib/bridge'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/primitives'
import { Omnibox } from './Omnibox'

/**
 * The toolbar, in groups.
 *
 * Twelve icons in one evenly spaced run is a row you have to read every time,
 * because nothing says where navigation ends and panels begin. Grouped --
 * window, navigation, this page, panels -- the eye picks a region and then an
 * icon, which is one decision rather than twelve.
 */
export function Toolbar(): JSX.Element {
  const tab = useActiveTab()
  const bookmarks = useAppStore((store) => store.state.bookmarks)
  const { sidebarOpen, toggleSidebar, toggleRightPanel, findOpen, setFindOpen } = useUiStore()
  // Several docks can each be showing something, so "is this panel open" is a
  // membership test rather than a comparison against one right-hand panel.
  const openPanels = useOpenPanels()
  const downloading = useAppStore((store) =>
    store.state.downloads.some((item) => item.state === 'progressing')
  )

  const bookmarked = tab ? bookmarks.some((bookmark) => bookmark.url === tab.url) : false

  return (
    <div className="rx-toolbar" data-radius-part="toolbar">
      <IconButton
        aria-label="Toggle sidebar"
        title="Toggle sidebar"
        active={sidebarOpen}
        onClick={toggleSidebar}
      >
        <Icon name="sidebar" />
      </IconButton>

      <div className="rx-toolbar-group">
        <IconButton
          aria-label="Back"
          title="Back"
          disabled={!tab?.canGoBack}
          onClick={() => tab && send('tabs:goBack', { tabId: tab.id })}
        >
          <Icon name="back" />
        </IconButton>
        <IconButton
          aria-label="Forward"
          title="Forward"
          disabled={!tab?.canGoForward}
          onClick={() => tab && send('tabs:goForward', { tabId: tab.id })}
        >
          <Icon name="forward" />
        </IconButton>
        <IconButton
          aria-label={tab?.loading ? 'Stop' : 'Reload'}
          title={tab?.loading ? 'Stop loading' : 'Reload'}
          onClick={() => {
            if (!tab) return
            if (tab.loading) send('tabs:stop', { tabId: tab.id })
            else send('tabs:reload', { tabId: tab.id })
          }}
        >
          <Icon name={tab?.loading ? 'stop' : 'reload'} />
        </IconButton>
      </div>

      <Omnibox />

      {/* Things you do to the page in front of you. */}
      <div className="rx-toolbar-group">
        <IconButton
          aria-label="Bookmark this page"
          title={bookmarked ? 'Remove bookmark' : 'Bookmark this page'}
          active={bookmarked}
          disabled={!tab || !tab.url || tab.url === 'about:blank'}
          onClick={() => {
            if (!tab) return
            const existing = bookmarks.find((bookmark) => bookmark.url === tab.url)
            if (existing) send('bookmarks:delete', { bookmarkId: existing.id })
            else
              send('bookmarks:create', {
                url: tab.url,
                title: tab.title || tab.url,
                faviconUrl: tab.faviconUrl
              })
          }}
        >
          <Icon name={bookmarked ? 'star-filled' : 'star'} />
        </IconButton>
        <IconButton
          aria-label="Find in page"
          title="Find in page"
          active={findOpen}
          disabled={!tab}
          onClick={() => setFindOpen(!findOpen)}
        >
          <Icon name="search" />
        </IconButton>
      </div>

      {/* Panels. Each toggles the right-hand region. */}
      <div className="rx-toolbar-group">
        <IconButton
          aria-label="History"
          title="History"
          active={openPanels.includes('history')}
          onClick={() => toggleRightPanel('history')}
        >
          <Icon name="history" />
        </IconButton>
        <IconButton
          aria-label="Downloads"
          title={downloading ? 'Downloads — one in progress' : 'Downloads'}
          active={openPanels.includes('downloads')}
          onClick={() => toggleRightPanel('downloads')}
        >
          <Icon name={downloading ? 'arrow-down' : 'download'} />
          {downloading ? <span className="rx-badge-dot" /> : null}
        </IconButton>
        <IconButton
          aria-label="Toggle AI panel"
          title="Assistant"
          active={openPanels.includes('ai')}
          onClick={() => toggleRightPanel('ai')}
        >
          <Icon name="sparkle" />
        </IconButton>
        <IconButton
          aria-label="Agent"
          title="Let the assistant drive this page"
          active={openPanels.includes('agent')}
          onClick={() => toggleRightPanel('agent')}
        >
          <Icon name="agent" />
        </IconButton>
        <IconButton
          aria-label="Theme studio"
          title="Theme studio"
          active={openPanels.includes('theme')}
          onClick={() => toggleRightPanel('theme')}
        >
          <Icon name="palette" />
        </IconButton>
        <IconButton
          aria-label="Settings"
          title="Settings"
          active={openPanels.includes('settings')}
          onClick={() => toggleRightPanel('settings')}
        >
          <Icon name="settings" />
        </IconButton>
      </div>
    </div>
  )
}
