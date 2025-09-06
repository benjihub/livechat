import base64

encoded = "MWQwZWU4MTEtNmZmOS00YjA1LWIyZmYtZmIwM2FlMTE4NDZm"
decoded = base64.b64decode(encoded).decode("utf-8")
print(decoded)
