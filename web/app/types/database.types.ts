export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      devices: {
        Row: {
          id: string
          user_id: string
          name: string
          api_key: string
          last_seen: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          api_key: string
          last_seen?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          api_key?: string
          last_seen?: string | null
          created_at?: string
        }
      }
      schemas: {
        Row: {
          id: string
          device_id: string
          schema_definition: Json
          updated_at: string
        }
        Insert: {
          id?: string
          device_id: string
          schema_definition?: Json
          updated_at?: string
        }
        Update: {
          id?: string
          device_id?: string
          schema_definition?: Json
          updated_at?: string
        }
      }
      telemetry: {
        Row: {
          id: string
          device_id: string
          parsed_json: Json
          timestamp: string
        }
        Insert: {
          id?: string
          device_id: string
          parsed_json: Json
          timestamp?: string
        }
        Update: {
          id?: string
          device_id?: string
          parsed_json?: Json
          timestamp?: string
        }
      }
    }
  }
}
