bl_info = {
    "name": "AniMocap Fusion Selected Frames",
    "author": "AniMocap Fusion",
    "version": (0, 1, 0),
    "blender": (4, 2, 0),
    "location": "View3D > Sidebar > AniMocap",
    "description": "Import selected Canonical Motion poses into a new Action",
    "category": "Animation",
}

def register():
    from . import ui
    ui.register()


def unregister():
    from . import ui
    ui.unregister()
