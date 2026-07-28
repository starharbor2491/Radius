import type { JSX } from 'react'
import { useActiveTab, useAppStore } from '../store/useAppStore'
import { useUiStore } from '../store/useUiStore'
import { send } from '../lib/bridge'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/primitives'
import { Omnibox } from './Omnibox'

export function Toolbar(): JSX.Element {
  const tab = useActiveTab()
  const bookmarks = useAppStore((store) => store.state.bookmarks)
  const { sidebarOpen, toggleSidebar, rightPanel, toggleRightPanel, findOpen, setFindOpen } =
    useUiStore()
  const downloading = useAppStore((store) =>
    store.state.downloads.some((item) => item.state === 'progressing')
  )

  const bookmarked = tab ? bookmarks.some((bookmark) => bookmark.url === tab.url) : false

  return (
    <div className="rx-toolbar">
      <IconButton
        aria-label="Toggle sidebar"
        title="Toggle sidebar  ⌘B"
        active={sidebarOpen}
        onClick={toggleSidebar}
      >
        <Icon name="sidebar" />
      </IconButton>

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
        title={tab?.loading ? 'Stop' : 'Reload  ⌘R'}
        onClick={() => {
          if (!tab) return
          if (tab.loading) send('tabs:stop', { tabId: tab.id })
          else send('tabs:reload', { tabId: tab.id })
        }}
      >
        <Icon name={tab?.loading ? 'stop' : 'reload'} />
      </IconButton>

      <Omnibox />

      <IconButton
        aria-label="Bookmark this page"
        title={bookmarked ? 'Bookmarked' : 'Bookmark this page'}
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
        title="Find in page  ⌘F"
        active={findOpen}
        disabled={!tab}
        onClick={() => setFindOpen(!findOpen)}
      >
        <Icon name="search" />
      </IconButton>
      <IconButton
        aria-label="History"
        title="History  ⌘Y"
        active={rightPanel === 'history'}
        onClick={() => toggleRightPanel('history')}
      >
        <Icon name="history" />
      </IconButton>
      <IconButton
        aria-label="Downloads"
        title="Downloads  ⌘⇧J"
        active={rightPanel === 'downloads'}
        onClick={() => toggleRightPanel('downloads')}
      >
        <Icon name={downloading ? 'arrow-down' : 'download'} />
      </IconButton>

      <IconButton
        aria-label="Toggle AI panel"
        title="AI panel  ⌘J"
        active={rightPanel === 'ai'}
        onClick={() => toggleRightPanel('ai')}
      >
        <Icon name="sparkle" />
      </IconButton>
      <IconButton
        aria-label="Agent"
        title="Let the assistant drive  ⌘⇧A"
        active={rightPanel === 'agent'}
        onClick={() => toggleRightPanel('agent')}
      >
        <Icon name="agent" />
      </IconButton>
      <IconButton
        aria-label="Theme studio"
        title="Theme studio  ⌘⇧,"
        active={rightPanel === 'theme'}
        onClick={() => toggleRightPanel('theme')}
      >
        <Icon name="palette" />
      </IconButton>
      <IconButton
        aria-label="Settings"
        title="Settings"
        active={rightPanel === 'settings'}
        onClick={() => toggleRightPanel('settings')}
      >
        <Icon name="settings" />
      </IconButton>
    </div>
  )
}
