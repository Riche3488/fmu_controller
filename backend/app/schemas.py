"""API 스키마 — frontend/src/api/types.ts 와 동일한 형태 (JSON은 camelCase)."""
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class Health(CamelModel):
    status: str
    parallel_backend: str
