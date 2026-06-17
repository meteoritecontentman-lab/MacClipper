import SpriteKit

/// Represents something that can provide a value for drag-n-drop.
@MainActor
protocol DragSource {
    var draggableValue: Any { get }
    
    func makeHoverNode() -> SKNode
}
