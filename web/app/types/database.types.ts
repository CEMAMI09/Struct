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
          tags: Json
          encryption_enabled: boolean
          encryption_key: string | null
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          api_key: string
          last_seen?: string | null
          created_at?: string
          tags?: Json
          encryption_enabled?: boolean
          encryption_key?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          api_key?: string
          last_seen?: string | null
          created_at?: string
          tags?: Json
          encryption_enabled?: boolean
          encryption_key?: string | null
        }
      }
      schemas: {
        Row: {
          id: string
          device_id: string
          schema_definition: Json
          version: number
          updated_at: string
        }
        Insert: {
          id?: string
          device_id: string
          schema_definition?: Json
          version?: number
          updated_at?: string
        }
        Update: {
          id?: string
          device_id?: string
          schema_definition?: Json
          version?: number
          updated_at?: string
        }
      }
      schema_versions: {
        Row: {
          id: string
          device_id: string
          version: number
          schema_definition: Json
          created_at: string
        }
        Insert: {
          id?: string
          device_id: string
          version: number
          schema_definition?: Json
          created_at?: string
        }
        Update: {
          id?: string
          device_id?: string
          version?: number
          schema_definition?: Json
          created_at?: string
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
      destinations: {
        Row: {
          id: string
          user_id: string
          name: string
          url: string
          device_id: string | null
          enabled: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          url: string
          device_id?: string | null
          enabled?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          url?: string
          device_id?: string | null
          enabled?: boolean
          created_at?: string
        }
      }
      pending_commands: {
        Row: {
          id: string
          device_id: string
          user_id: string
          command_type: string
          payload: Json
          packed_hex: string
          status: string
          created_at: string
          delivered_at: string | null
        }
        Insert: {
          id?: string
          device_id: string
          user_id: string
          command_type?: string
          payload?: Json
          packed_hex: string
          status?: string
          created_at?: string
          delivered_at?: string | null
        }
        Update: {
          id?: string
          device_id?: string
          user_id?: string
          command_type?: string
          payload?: Json
          packed_hex?: string
          status?: string
          created_at?: string
          delivered_at?: string | null
        }
      }
    }
  }
}
