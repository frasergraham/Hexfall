import Foundation
import Capacitor
import GameKit
import UIKit

@objc(GameCenterPlugin)
public class GameCenterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GameCenterPlugin"
    public let jsName = "GameCenter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "submitScore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reportAchievement", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadAchievements", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showLeaderboard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showAchievements", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadLeaderboardEntries", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadFriends", returnType: CAPPluginReturnPromise),
    ]

    private var didTryAuth = false

    @objc func authenticate(_ call: CAPPluginCall) {
        let local = GKLocalPlayer.local

        if local.isAuthenticated {
            call.resolve(self.identityPayload(local))
            return
        }

        // Game Center will replay the handler whenever auth state changes,
        // so we have to be careful to only resolve the *current* call once.
        if didTryAuth {
            call.resolve(self.identityPayload(local))
            return
        }
        didTryAuth = true

        local.authenticateHandler = { [weak self] viewController, error in
            guard let self = self else { return }

            if let vc = viewController {
                DispatchQueue.main.async {
                    self.bridge?.viewController?.present(vc, animated: true, completion: nil)
                }
                return
            }

            if let err = error {
                CAPLog.print("[GameCenter] auth error:", err.localizedDescription)
                call.resolve(["authenticated": false])
                return
            }

            call.resolve(self.identityPayload(local))
        }
    }

    private func identityPayload(_ player: GKLocalPlayer) -> [String: Any] {
        var out: [String: Any] = ["authenticated": player.isAuthenticated]
        if player.isAuthenticated {
            out["displayName"] = player.displayName
            out["alias"] = player.alias
        }
        return out
    }

    @objc func submitScore(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.reject("Game Center not authenticated")
            return
        }
        guard let leaderboardId = call.getString("leaderboardId") else {
            call.reject("Missing leaderboardId")
            return
        }
        let score = call.getInt("score") ?? 0

        if #available(iOS 14.0, *) {
            GKLeaderboard.submitScore(
                score,
                context: 0,
                player: GKLocalPlayer.local,
                leaderboardIDs: [leaderboardId]
            ) { error in
                if let error = error {
                    call.reject("submitScore failed: \(error.localizedDescription)")
                } else {
                    call.resolve()
                }
            }
        } else {
            let gkScore = GKScore(leaderboardIdentifier: leaderboardId)
            gkScore.value = Int64(score)
            GKScore.report([gkScore]) { error in
                if let error = error {
                    call.reject("submitScore failed: \(error.localizedDescription)")
                } else {
                    call.resolve()
                }
            }
        }
    }

    @objc func reportAchievement(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.reject("Game Center not authenticated")
            return
        }
        guard let id = call.getString("id") else {
            call.reject("Missing achievement id")
            return
        }
        let percent = call.getDouble("percentComplete") ?? 100.0

        let achievement = GKAchievement(identifier: id)
        achievement.percentComplete = percent
        achievement.showsCompletionBanner = true

        GKAchievement.report([achievement]) { error in
            if let error = error {
                call.reject("reportAchievement failed: \(error.localizedDescription)")
            } else {
                call.resolve()
            }
        }
    }

    // Returns IDs of every achievement the player has fully completed in
    // Game Center, so the JS layer can seed the local earned-set on launch.
    @objc func loadAchievements(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.reject("Game Center not authenticated")
            return
        }
        GKAchievement.loadAchievements { achievements, error in
            if let error = error {
                call.reject("loadAchievements failed: \(error.localizedDescription)")
                return
            }
            let ids = (achievements ?? [])
                .filter { $0.percentComplete >= 100.0 }
                .compactMap { $0.identifier }
            call.resolve(["ids": ids])
        }
    }

    @objc func showAchievements(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.reject("Game Center not authenticated")
            return
        }
        DispatchQueue.main.async {
            let vc: GKGameCenterViewController
            if #available(iOS 14.0, *) {
                vc = GKGameCenterViewController(state: .achievements)
            } else {
                vc = GKGameCenterViewController()
                vc.viewState = .achievements
            }
            vc.gameCenterDelegate = GameCenterDelegateProxy.shared
            self.bridge?.viewController?.present(vc, animated: true, completion: nil)
            call.resolve()
        }
    }

    // Read leaderboard entries programmatically so the JS layer can
    // render its own in-game sheet (top 10 + local-player row, with a
    // global / friends scope toggle). The native GKGameCenterViewController
    // sheet is still reachable via showLeaderboard for anyone who wants
    // Apple's chrome.
    @objc func loadLeaderboardEntries(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.reject("Game Center not authenticated")
            return
        }
        guard let leaderboardId = call.getString("leaderboardId") else {
            call.reject("Missing leaderboardId")
            return
        }
        let scopeStr = call.getString("scope") ?? "global"
        let limit = max(1, min(100, call.getInt("limit") ?? 10))

        if #available(iOS 14.0, *) {
            let scope: GKLeaderboard.PlayerScope = (scopeStr == "friends") ? .friendsOnly : .global
            GKLeaderboard.loadLeaderboards(IDs: [leaderboardId]) { boards, err in
                if let err = err {
                    call.reject("loadLeaderboards failed: \(err.localizedDescription)")
                    return
                }
                guard let board = boards?.first else {
                    call.resolve(["entries": [], "localPlayer": NSNull()])
                    return
                }
                board.loadEntries(
                    for: scope,
                    timeScope: .allTime,
                    range: NSRange(location: 1, length: limit)
                ) { localEntry, entries, _, loadErr in
                    if let loadErr = loadErr {
                        call.reject("loadEntries failed: \(loadErr.localizedDescription)")
                        return
                    }
                    let payload = (entries ?? []).map { entry -> [String: Any] in
                        return [
                            "rank": entry.rank,
                            "score": entry.score,
                            "playerId": entry.player.gamePlayerID,
                            "playerName": entry.player.displayName,
                        ]
                    }
                    var local: Any = NSNull()
                    if let le = localEntry {
                        local = [
                            "rank": le.rank,
                            "score": le.score,
                            "playerId": le.player.gamePlayerID,
                            "playerName": le.player.displayName,
                        ]
                    }
                    call.resolve(["entries": payload, "localPlayer": local])
                }
            }
        } else {
            // Pre-iOS 14: programmatic friend / range fetches require the
            // legacy GKLeaderboard API which is deprecated. Fall back to an
            // empty payload — the JS layer renders an empty state.
            call.resolve(["entries": [], "localPlayer": NSNull()])
        }
    }

    // Trigger the friend-list authorization prompt (iOS 14.5+) so the
    // friends-scope leaderboard fetch can return entries. Resolves
    // { authorized: Bool } so the JS side can render an "ask for
    // permission" empty state when the user has declined.
    @objc func loadFriends(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.reject("Game Center not authenticated")
            return
        }
        if #available(iOS 14.5, *) {
            GKLocalPlayer.local.loadFriendsAuthorizationStatus { status, err in
                if let err = err {
                    call.reject("loadFriendsAuthorizationStatus failed: \(err.localizedDescription)")
                    return
                }
                if status == .authorized {
                    call.resolve(["authorized": true])
                    return
                }
                if status == .notDetermined {
                    GKLocalPlayer.local.loadFriends { _, friendsErr in
                        if let friendsErr = friendsErr {
                            call.reject("loadFriends failed: \(friendsErr.localizedDescription)")
                            return
                        }
                        call.resolve(["authorized": true])
                    }
                    return
                }
                // .denied or .restricted
                call.resolve(["authorized": false])
            }
        } else {
            // Older iOS doesn't gate friends behind explicit auth — the
            // GKLeaderboard friends-scope query just works.
            call.resolve(["authorized": true])
        }
    }

    @objc func showLeaderboard(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.reject("Game Center not authenticated")
            return
        }
        let leaderboardId = call.getString("leaderboardId")

        DispatchQueue.main.async {
            let vc = GKGameCenterViewController()
            vc.gameCenterDelegate = GameCenterDelegateProxy.shared
            if #available(iOS 14.0, *), let id = leaderboardId {
                let modern = GKGameCenterViewController(
                    leaderboardID: id,
                    playerScope: .global,
                    timeScope: .allTime
                )
                modern.gameCenterDelegate = GameCenterDelegateProxy.shared
                self.bridge?.viewController?.present(modern, animated: true, completion: nil)
            } else {
                vc.viewState = .leaderboards
                self.bridge?.viewController?.present(vc, animated: true, completion: nil)
            }
            call.resolve()
        }
    }
}

// GameKit requires a non-nil delegate to dismiss the leaderboard sheet.
class GameCenterDelegateProxy: NSObject, GKGameCenterControllerDelegate {
    static let shared = GameCenterDelegateProxy()

    func gameCenterViewControllerDidFinish(_ gameCenterViewController: GKGameCenterViewController) {
        gameCenterViewController.dismiss(animated: true, completion: nil)
    }
}
