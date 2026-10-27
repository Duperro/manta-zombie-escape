import math
from dataclasses import dataclass, field

def percentile(values, p):
    return sorted(values)[max(0, math.ceil(len(values)*p)-1)] if values else None

@dataclass
class Metrics:
    latencies_ms: list[float] = field(default_factory=list)
    http_errors: int = 0
    invalid_responses: int = 0
    over_500ms: int = 0
    valid_moves: int = 0
    invalid_moves: int = 0
    turn_records: list[dict] = field(default_factory=list)
    rescues_cancelled: int = 0

    def summary(self, survivors):
        initial = len(survivors)
        evacuated = sum(s.status == "EVACUADO" for s in survivors)
        eliminated = sum(s.status == "ELIMINADO" for s in survivors)
        active = initial - evacuated - eliminated
        turns = [s.evacuation_turn for s in survivors if s.evacuation_turn is not None]
        count = len(self.latencies_ms)
        return dict(sobrevivientesIniciales=initial,evacuados=evacuated,eliminados=eliminated,activos=active,
            porcentajeSupervivencia=100*(initial-eliminated)/initial if initial else 0,
            tasaEvacuacion=100*evacuated/initial if initial else 0,
            turnosPromedioEvacuacion=sum(turns)/len(turns) if turns else None,
            rutasValidas=self.valid_moves,rutasInvalidas=self.invalid_moves,solicitudesHTTP=count,
            erroresHTTP=self.http_errors,respuestasInvalidas=self.invalid_responses,solicitudesSobre500ms=self.over_500ms,
            latenciaPromedioMs=sum(self.latencies_ms)/count if count else None,
            latenciaP50Ms=percentile(self.latencies_ms,.5),latenciaP95Ms=percentile(self.latencies_ms,.95),
            latenciaP99Ms=percentile(self.latencies_ms,.99),
            disponibilidadEndpoint=(count-self.http_errors)/count if count else None,
            vivosFinales=initial-eliminated,
            evacuadosCaminando=sum(s.status=="EVACUADO" and s.evacuation_mode!="camioneta" for s in survivors),
            evacuadosCamioneta=sum(s.status=="EVACUADO" and s.evacuation_mode=="camioneta" for s in survivors),
            rescatesCompletados=sum(s.status=="EVACUADO" and s.evacuation_mode=="camioneta" for s in survivors),
            rescatesCancelados=self.rescues_cancelled,
            distanciaCaminada_m=sum(s.walking_distance_m for s in survivors),
            distanciaTransportada_m=sum(s.vehicle_distance_m for s in survivors))
