/// Represents something that may be selected.
@MainActor
protocol Selectable: AnyObject {
    var isSelected: Bool { get set }
}
