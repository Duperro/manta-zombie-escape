from fastapi import FastAPI

app = FastAPI(
    title=Manta Zombie Escape,
    version=0.1.0
)

@app.get(health)
def health()
    return {
        status ok,
        service zombie-escape
    }