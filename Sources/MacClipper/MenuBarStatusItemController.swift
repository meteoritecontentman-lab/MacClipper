import AppKit
import Combine
import SwiftUI

@MainActor
final class MenuBarStatusItemController: NSObject {
    private enum Constants {
        static let compactStatusItemLength: CGFloat = 34
        static let textFallbackStatusItemLength: CGFloat = 44
        static let visibilityCheckInterval: TimeInterval = 2
        static let launchReachabilityRescueDelay: TimeInterval = 1.25
        static let launchSetupRescueDelay: TimeInterval = 0.75
    }

    private final class MenuBarPanel: NSPanel {
        override var canBecomeKey: Bool { true }
        override var canBecomeMain: Bool { false }
    }

    private let model: AppModel
    private var statusItem: NSStatusItem
    private let panel: MenuBarPanel
    private let hostingView: NSHostingView<AnyView>
    private var outsideClickMonitor: Any?
    private var cancellables: Set<AnyCancellable> = []
    private var statusItemMonitor: Timer?
    private var appNotificationObservers: [NSObjectProtocol] = []
    private var workspaceNotificationObservers: [NSObjectProtocol] = []
    private var statusItemRepairAttempts = 0
    private var hasEnabledDockFallback = false

    init(model: AppModel) {
        self.model = model
        self.statusItem = Self.makeStatusItem(length: Constants.compactStatusItemLength)
        self.hostingView = NSHostingView(
            rootView: AnyView(
                MenuContentView()
                    .environmentObject(model)
            )
        )
        self.panel = MenuBarPanel(
            contentRect: NSRect(x: 0, y: 0, width: 584, height: 640),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        super.init()
        configureStatusItem()
        configurePanel()
        bindModel()
        startStatusItemMonitoring()
        showPanelIfNeededOnLaunch()
        rescueLaunchReachabilityIfNeeded()
    }

    private static func makeStatusItem(length: CGFloat) -> NSStatusItem {
        NSStatusBar.system.statusItem(withLength: length)
    }

    private func configureStatusItem() {
        guard let button = statusItem.button else { return }
        button.target = self
        button.action = #selector(togglePopover(_:))
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        button.imagePosition = .imageOnly
        button.imageScaling = .scaleProportionallyDown
        button.toolTip = "MacClipper"
        button.font = .systemFont(ofSize: 12, weight: .bold)
        updateButtonImage(isRecording: model.isRecording)
    }

    private func configurePanel() {
        hostingView.translatesAutoresizingMaskIntoConstraints = false

        let container = NSView(frame: NSRect(x: 0, y: 0, width: 584, height: 640))
        container.wantsLayer = true
        container.addSubview(hostingView)

        NSLayoutConstraint.activate([
            hostingView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            hostingView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            hostingView.topAnchor.constraint(equalTo: container.topAnchor),
            hostingView.bottomAnchor.constraint(equalTo: container.bottomAnchor)
        ])

        panel.contentView = container
        panel.isReleasedWhenClosed = false
        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.hasShadow = true
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
    }

    private func bindModel() {
        model.$isRecording
            .receive(on: RunLoop.main)
            .sink { [weak self] isRecording in
                self?.updateButtonImage(isRecording: isRecording)
            }
            .store(in: &cancellables)

        model.$shouldShowLaunchSetup
            .removeDuplicates()
            .receive(on: RunLoop.main)
            .sink { [weak self] shouldShowLaunchSetup in
                guard shouldShowLaunchSetup else { return }
                self?.presentLaunchSetupIfNeeded()
            }
            .store(in: &cancellables)
    }

    private func showPanelIfNeededOnLaunch() {
        guard model.shouldShowLaunchSetup else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            self?.presentLaunchSetupIfNeeded()
        }
    }

    private func presentLaunchSetupIfNeeded() {
        guard model.shouldShowLaunchSetup else { return }

        if hasEnabledDockFallback {
            showPanelWithoutStatusItemAnchor()
        } else if isStatusItemHealthy {
            showPanelIfPossible()
        } else {
            enableDockFallback()
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + Constants.launchSetupRescueDelay) { [weak self] in
            guard let self, self.model.shouldShowLaunchSetup, !self.panel.isVisible else { return }
            self.enableDockFallback()
        }
    }

    private func updateButtonImage(isRecording: Bool) {
        guard let button = statusItem.button else { return }

        if let image = makeButtonImage(isRecording: isRecording) {
            statusItem.length = Constants.compactStatusItemLength
            button.imagePosition = .imageOnly
            button.image = image
            button.title = ""
        } else {
            statusItem.length = Constants.textFallbackStatusItemLength
            button.imagePosition = .noImage
            button.image = nil
            button.title = isRecording ? "MC*" : "MC"
        }
    }

    private func makeButtonImage(isRecording: Bool) -> NSImage? {
        let symbolName = isRecording ? "bolt.circle.fill" : "bolt.circle"
        let configuration = NSImage.SymbolConfiguration(pointSize: 15, weight: .semibold)

        if let image = NSImage(systemSymbolName: symbolName, accessibilityDescription: "MacClipper")?
            .withSymbolConfiguration(configuration) {
            image.isTemplate = true
            return image
        }

        if let image = MacClipperIconAsset.image(size: 18) {
            image.isTemplate = false
            return image
        }

        return nil
    }

    private func refreshPanelSize() {
        hostingView.layoutSubtreeIfNeeded()
        let fittingSize = hostingView.fittingSize
        let size = NSSize(
            width: max(560, fittingSize.width),
            height: max(420, fittingSize.height)
        )
        panel.setContentSize(size)
    }

    private func positionPanel(relativeTo button: NSStatusBarButton) {
        guard let buttonWindow = button.window else { return }

        let buttonFrameInWindow = button.convert(button.bounds, to: nil)
        let buttonFrameOnScreen = buttonWindow.convertToScreen(buttonFrameInWindow)
        let visibleFrame = buttonWindow.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? .zero
        let panelSize = panel.frame.size

        let originX = min(
            max(buttonFrameOnScreen.midX - (panelSize.width / 2), visibleFrame.minX + 8),
            visibleFrame.maxX - panelSize.width - 8
        )
        let originY = max(visibleFrame.minY + 8, buttonFrameOnScreen.minY - panelSize.height - 8)

        panel.setFrameOrigin(NSPoint(x: originX, y: originY))
    }

    private func centerPanelOnScreen() {
        panel.center()
    }

    private func showPanelIfPossible() {
        guard !panel.isVisible, let button = statusItem.button else { return }
        refreshPanelSize()
        positionPanel(relativeTo: button)
        panel.makeKeyAndOrderFront(nil)
        panel.orderFrontRegardless()
        NSApp.activate(ignoringOtherApps: true)
        installOutsideClickMonitor()
    }

    private func showPanelWithoutStatusItemAnchor() {
        guard !panel.isVisible else { return }
        refreshPanelSize()
        centerPanelOnScreen()
        panel.makeKeyAndOrderFront(nil)
        panel.orderFrontRegardless()
        NSApp.activate(ignoringOtherApps: true)
        installOutsideClickMonitor()
    }

    private func closePanel() {
        panel.orderOut(nil)
        removeOutsideClickMonitor()
    }

    private func installOutsideClickMonitor() {
        guard outsideClickMonitor == nil else { return }
        outsideClickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            Task { @MainActor in
                self?.closePanel()
            }
        }
    }

    private func removeOutsideClickMonitor() {
        guard let outsideClickMonitor else { return }
        NSEvent.removeMonitor(outsideClickMonitor)
        self.outsideClickMonitor = nil
    }

    private func startStatusItemMonitoring() {
        statusItemMonitor = Timer.scheduledTimer(withTimeInterval: Constants.visibilityCheckInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.repairStatusItemIfNeeded()
            }
        }

        let appCenter = NotificationCenter.default
        appNotificationObservers.append(
            appCenter.addObserver(
                forName: NSApplication.didBecomeActiveNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                Task { @MainActor in
                    self?.repairStatusItemIfNeeded()
                }
            }
        )

        let workspaceCenter = NSWorkspace.shared.notificationCenter
        workspaceNotificationObservers.append(
            workspaceCenter.addObserver(
                forName: NSWorkspace.activeSpaceDidChangeNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                Task { @MainActor in
                    self?.repairStatusItemIfNeeded()
                }
            }
        )

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            self?.repairStatusItemIfNeeded()
        }
    }

    private func rescueLaunchReachabilityIfNeeded() {
        DispatchQueue.main.asyncAfter(deadline: .now() + Constants.launchReachabilityRescueDelay) { [weak self] in
            guard let self, !self.hasEnabledDockFallback, !self.isStatusItemHealthy else { return }
            self.enableDockFallback()

            if self.model.shouldShowLaunchSetup || !self.panel.isVisible {
                self.showPanelWithoutStatusItemAnchor()
            }
        }
    }

    private func stopStatusItemMonitoring() {
        statusItemMonitor?.invalidate()
        statusItemMonitor = nil

        let appCenter = NotificationCenter.default
        for observer in appNotificationObservers {
            appCenter.removeObserver(observer)
        }
        appNotificationObservers.removeAll()

        let workspaceCenter = NSWorkspace.shared.notificationCenter
        for observer in workspaceNotificationObservers {
            workspaceCenter.removeObserver(observer)
        }
        workspaceNotificationObservers.removeAll()
    }

    private func repairStatusItemIfNeeded() {
        guard !isStatusItemHealthy else {
            statusItemRepairAttempts = 0
            return
        }

        recreateStatusItem()
        statusItemRepairAttempts += 1

        if !isStatusItemHealthy, statusItemRepairAttempts >= 2 {
            enableDockFallback()
        }
    }

    private var isStatusItemHealthy: Bool {
        guard let button = statusItem.button else { return false }
        let hasVisibleContent = button.image != nil || !button.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return hasVisibleContent && button.window != nil
    }

    private func recreateStatusItem() {
        let oldStatusItem = statusItem
        let newStatusItem = Self.makeStatusItem(length: oldStatusItem.length > 0 ? oldStatusItem.length : Constants.compactStatusItemLength)
        statusItem = newStatusItem
        configureStatusItem()
        NSStatusBar.system.removeStatusItem(oldStatusItem)
    }

    private func enableDockFallback() {
        guard !hasEnabledDockFallback else { return }
        hasEnabledDockFallback = true

        NSApp.setActivationPolicy(.regular)
        model.statusText = "MacClipper is using its Dock fallback because the menu bar icon did not stay attached."
        showPanelWithoutStatusItemAnchor()
    }

    func invalidate() {
        stopStatusItemMonitoring()
        removeOutsideClickMonitor()
        panel.orderOut(nil)
    }

    @objc
    private func togglePopover(_ sender: NSStatusBarButton) {
        if panel.isVisible {
            closePanel()
        } else {
            showPanelIfPossible()
        }
    }
}